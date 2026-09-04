"""
Generate Self-Signed SSL Certificate for FastAPI Backend
Uses Python's cryptography package (no OpenSSL CLI required)

USAGE:
    python backend/generate-cert.py
    cd backend && python generate-cert.py
"""

import ipaddress
import os
import socket
from datetime import datetime, timedelta, timezone

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend
except ImportError:
    print("Installing cryptography package...")
    import subprocess
    subprocess.check_call(['pip', 'install', 'cryptography'])
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend

def get_local_ips():
    """Get all local IP addresses."""
    ips = []
    hostname = socket.gethostname()
    
    # Get primary IP
    try:
        primary_ip = socket.gethostbyname(hostname)
        if primary_ip and not primary_ip.startswith('127.'):
            ips.append(primary_ip)
    except:
        pass
    
    # Try to get more IPs from all network interfaces
    import socket as s
    try:
        for interface in s.getaddrinfo(hostname, None):
            ip = interface[4][0]
            if ip and not ip.startswith('127.') and ip not in ips and ':' not in ip:
                ips.append(ip)
    except:
        pass
    
    # Add common private IP ranges if not already present
    # This ensures both network interfaces are covered
    additional_ips = ['192.168.4.190', '10.66.154.172']
    for ip in additional_ips:
        if ip not in ips:
            ips.append(ip)
    
    return ips

def generate_certificate():
    """Generate a self-signed certificate."""
    
    print("Generating self-signed SSL certificate...\n")
    
    # Get local IPs for Subject Alternative Names
    local_ips = get_local_ips()
    
    print(f"  Found local IPs: {local_ips}")
    
    # Generate private key
    print("  Generating private key...")
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )
    
    # Certificate subject
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Local Development"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])
    
    # Build certificate
    print("  Building certificate...")
    cert_builder = x509.CertificateBuilder()
    cert_builder = cert_builder.subject_name(subject)
    cert_builder = cert_builder.issuer_name(issuer)
    cert_builder = cert_builder.public_key(private_key.public_key())
    cert_builder = cert_builder.serial_number(x509.random_serial_number())
    cert_builder = cert_builder.not_valid_before(datetime.now(timezone.utc))
    cert_builder = cert_builder.not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
    
    # Add extensions
    cert_builder = cert_builder.add_extension(
        x509.BasicConstraints(ca=True, path_length=None),
        critical=True,
    )
    
    cert_builder = cert_builder.add_extension(
        x509.KeyUsage(
            digital_signature=True,
            key_encipherment=True,
            key_cert_sign=True,
            key_agreement=False,
            content_commitment=False,
            data_encipherment=False,
            crl_sign=False,
            encipher_only=False,
            decipher_only=False,
        ),
        critical=True,
    )
    
    cert_builder = cert_builder.add_extension(
        x509.ExtendedKeyUsage([
            x509.OID_SERVER_AUTH,
            x509.OID_CLIENT_AUTH,
        ]),
        critical=False,
    )
    
    # Add Subject Alternative Names
    san_list = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    
    # Add all local IPs
    for ip in local_ips:
        try:
            san_list.append(x509.IPAddress(ipaddress.IPv4Address(ip)))
        except:
            pass
    
    cert_builder = cert_builder.add_extension(
        x509.SubjectAlternativeName(san_list),
        critical=False,
    )
    
    # Sign certificate
    print("  Signing certificate...")
    certificate = cert_builder.sign(
        private_key=private_key,
        algorithm=hashes.SHA256(),
        backend=default_backend()
    )
    
    # Write files
    cert_path = os.path.join(os.path.dirname(__file__), 'cert.pem')
    key_path = os.path.join(os.path.dirname(__file__), 'key.pem')
    
    print(f"  Writing certificate to {cert_path}...")
    with open(cert_path, "wb") as f:
        f.write(certificate.public_bytes(serialization.Encoding.PEM))
    
    print(f"  Writing key to {key_path}...")
    with open(key_path, "wb") as f:
        f.write(private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
    
    print("\n✓ SSL certificate generated successfully!\n")
    print("Files created:")
    print(f"  - {cert_path}")
    print(f"  - {key_path}\n")
    print("The certificate includes:")
    print("  - localhost")
    print("  - 127.0.0.1")
    for ip in local_ips:
        print(f"  - {ip}")
    print("\nYou can now run: python -m backend.main --ssl")
    print("Then access via: https://YOUR-IP:5000\n")
    print("NOTE: Your browser will show a security warning for self-signed certificates.")
    print("      Click 'Proceed' or 'Accept Risk' to continue.\n")

if __name__ == '__main__':
    generate_certificate()
