// ─────────────────────────────────────────────────────────────────────────────
//  Crea el bucket PRIVADO donde viven los PDFs de diseño.
//
//    node scripts/crear-bucket.mjs
//
//  Es idempotente: si el bucket ya existe, solo lo reporta. Se corre una vez
//  por proyecto de Supabase (producción y, si lo hubiera, el de pruebas).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const AQUI = dirname(fileURLToPath(import.meta.url));

function cargarEnv() {
  try {
    const texto = readFileSync(join(AQUI, '..', '.env.local'), 'utf8');
    for (const linea of texto.split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    /* sin .env.local: se usan las variables del sistema */
  }
}

cargarEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secreta = process.env.SUPABASE_SECRET_KEY;
if (!url || !secreta) {
  console.error('✗ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local.');
  process.exit(1);
}

const BUCKET = 'disenos';
// 25 MB: de sobra para un plano. El límite del formulario sigue siendo menor.
const MAX_BYTES = 25 * 1024 * 1024;

const supabase = createClient(url, secreta, { auth: { persistSession: false } });

const { data: existentes, error: errorLista } = await supabase.storage.listBuckets();
if (errorLista) {
  console.error('✗ No se pudo consultar Storage:', errorLista.message);
  process.exit(1);
}

if (existentes.some(b => b.name === BUCKET)) {
  console.log(`✓ El bucket "${BUCKET}" ya existe.`);
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false, // privado: solo se llega con URL firmada
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ['application/pdf'],
  });
  if (error) {
    console.error('✗ No se pudo crear el bucket:', error.message);
    process.exit(1);
  }
  console.log(`✓ Bucket "${BUCKET}" creado (privado, solo PDF, máx. 25 MB).`);
}

// Comprobación real: subir un archivo de prueba, firmarlo y borrarlo.
const prueba = `pruebas/verificacion-${Date.now()}.pdf`;
const contenido = new Blob([new TextEncoder().encode('%PDF-1.4 prueba')], { type: 'application/pdf' });

const { error: errSubida } = await supabase.storage.from(BUCKET).upload(prueba, contenido, {
  contentType: 'application/pdf',
});
if (errSubida) {
  console.error('✗ No se pudo subir el archivo de prueba:', errSubida.message);
  process.exit(1);
}

const { data: firmada, error: errFirma } = await supabase.storage.from(BUCKET).createSignedUrl(prueba, 60);
if (errFirma) {
  console.error('✗ No se pudo firmar la URL de lectura:', errFirma.message);
  process.exit(1);
}

const res = await fetch(firmada.signedUrl);
await supabase.storage.from(BUCKET).remove([prueba]);

if (!res.ok) {
  console.error(`✗ La URL firmada respondió ${res.status}.`);
  process.exit(1);
}

console.log('✓ Subida, URL firmada y borrado: funcionando.');
