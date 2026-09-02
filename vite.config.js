// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the directory name (ESM compatible)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Check if SSL cert files exist (for custom HTTPS setup)
const certPath = path.resolve(__dirname, 'cert.pem')
const keyPath = path.resolve(__dirname, 'key.pem')
const certExists = fs.existsSync(certPath) && fs.existsSync(keyPath)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,  // Allow network access (binds to 0.0.0.0)
    port: 5173,  // Default Vite port
    // Enable HTTPS if cert files exist, otherwise use HTTP
    https: certExists ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    } : false,
  },
})