// ─────────────────────────────────────────────────────────────────────────────
//  Copia el worker de pdf.js a /public para el visor de PDFs del navegador.
//
//  Corre solo antes de `npm run dev` y `npm run build` (hooks predev/prebuild).
//  Así el worker siempre coincide con la versión instalada de pdfjs-dist
//  (si no coinciden, pdf.js truena con "version mismatch").
// ─────────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const origen = join(here, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destinoDir = join(here, "..", "public");
const destino = join(destinoDir, "pdf.worker.min.mjs");

if (!existsSync(origen)) {
  console.error("✗ No se encontró pdfjs-dist. ¿Corriste npm install?");
  process.exit(1);
}

mkdirSync(destinoDir, { recursive: true });
copyFileSync(origen, destino);
console.log("✓ pdf.worker.min.mjs copiado a /public");
