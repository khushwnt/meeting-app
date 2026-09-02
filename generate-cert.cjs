/**
 * Generate Self-Signed SSL Certificate for Vite
 * 
 * This script uses Node.js to generate a self-signed certificate
 * for local HTTPS development.
 * 
 * USAGE:
 *   node generate-cert.cjs
 * 
 * REQUIRES:
 *   npm install -D selfsigned
 */

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const os = require('os');

const certPath = path.resolve(__dirname, 'cert.pem');
const keyPath = path.resolve(__dirname, 'key.pem');

// Check if certificates already exist
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('✓ SSL certificates already exist');
  console.log(`  Certificate: ${certPath}`);
  console.log(`  Key: ${keyPath}`);
  console.log('\nTo regenerate, delete these files and run again.');
  process.exit(0);
}

console.log('Generating self-signed SSL certificate...\n');

// Get all network interface IPs
const networkInterfaces = os.networkInterfaces();
const altNames = [
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },
  { type: 7, ip: '::1' }
];

// Add all IPv4 addresses from network interfaces
Object.values(networkInterfaces).forEach(ifaces => {
  ifaces.forEach(iface => {
    if (iface.family === 'IPv4' && !iface.internal) {
      altNames.push({ type: 7, ip: iface.address });
      console.log(`  Adding network IP: ${iface.address}`);
    }
  });
});

// Certificate attributes
const attrs = [
  { name: 'commonName', value: 'localhost' },
  { name: 'countryName', value: 'US' },
  { name: 'stateOrProvinceName', value: 'California' },
  { name: 'localityName', value: 'San Francisco' },
  { name: 'organizationName', value: 'Local Development' },
  { name: 'organizationalUnitName', value: 'Development' }
];

// Certificate extensions
const exts = [
  {
    name: 'basicConstraints',
    cA: true
  },
  {
    name: 'keyUsage',
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true
  },
  {
    name: 'extKeyUsage',
    serverAuth: true,
    clientAuth: true
  },
  {
    name: 'subjectAltName',
    altNames: altNames
  }
];

// Generate the certificate
const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  extensions: exts,
  hash: 'sha256',
  pkcs7: false,
  pem: true
});

// Write the certificate and key to files
fs.writeFileSync(certPath, pems.cert);
fs.writeFileSync(keyPath, pems.private);

console.log('\n✓ SSL certificate generated successfully!\n');
console.log('Files created:');
console.log(`  - ${certPath}`);
console.log(`  - ${keyPath}\n`);
console.log('The certificate includes:');
console.log('  - localhost');
console.log('  - 127.0.0.1');
console.log('  - All your network IP addresses\n');
console.log('You can now run: npm run dev');
console.log('Then access via: https://YOUR-IP:5173\n');
console.log('NOTE: Your browser will show a security warning for self-signed certificates.');
console.log('      Click "Proceed" or "Accept Risk" to continue.\n');
