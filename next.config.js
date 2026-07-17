/** @type {import('next').NextConfig} */
const nextConfig = {
  // Estos paquetes corren solo en el servidor (extracción de PDF + OCR) y usan
  // binarios nativos / archivos que no deben empaquetarse en el bundle del cliente.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist', 'tesseract.js', '@napi-rs/canvas'],
  },
};

module.exports = nextConfig;
