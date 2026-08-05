// ─────────────────────────────────────────────────────────────────────────────
//  RESPALDO DE LA BASE DE DATOS
//
//  Saca un volcado completo con pg_dump (formato comprimido) y borra los que
//  ya pasaron del periodo de retención. Pensado para correr solo, todos los
//  días, desde el Programador de tareas de Windows.
//
//    node scripts/respaldo.mjs
//
//  Configuración (opcional, en .env.local o como variables de entorno):
//    RESPALDO_DIR    carpeta destino   (por defecto ../respaldos-supersacos)
//    RESPALDO_DIAS   días a conservar  (por defecto 30)
//    PG_DUMP         ruta de pg_dump   (por defecto el del PATH)
//
//  IMPORTANTE: el destino debe estar en OTRO disco o en un NAS. Un respaldo en
//  el mismo disco que la base no protege contra la falla más común, que es que
//  ese disco muera.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

function cargarEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const texto = readFileSync(join(AQUI, '..', '.env.local'), 'utf8');
    for (const linea of texto.split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* sin .env.local: se confía en las variables del sistema */
  }
}

cargarEnv();

if (!process.env.DATABASE_URL) {
  console.error('✗ Falta DATABASE_URL (ponlo en .env.local).');
  process.exit(1);
}

const destino = process.env.RESPALDO_DIR || join(AQUI, '..', '..', 'respaldos-supersacos');
const dias = Number(process.env.RESPALDO_DIAS || 30);
const pgDump = process.env.PG_DUMP || 'pg_dump';

mkdirSync(destino, { recursive: true });

// Nombre con fecha y hora local: se ordena solo y no se pisa.
const ahora = new Date();
const p = (n) => String(n).padStart(2, '0');
const sello = `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}_${p(ahora.getHours())}${p(ahora.getMinutes())}`;
const archivo = join(destino, `supersacos-${sello}.dump`);

console.log(`Respaldando a ${archivo}`);

// -Fc = formato comprimido de PostgreSQL (se restaura con pg_restore).
const r = spawnSync(pgDump, ['-Fc', '-f', archivo, process.env.DATABASE_URL], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

if (r.error) {
  console.error(`✗ No se pudo ejecutar pg_dump (${pgDump}). ¿Está en el PATH?`);
  console.error('  Prueba con PG_DUMP="C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"');
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`✗ pg_dump terminó con código ${r.status}. El respaldo NO se completó.`);
  process.exit(1);
}

const mb = (statSync(archivo).size / 1024 / 1024).toFixed(1);
console.log(`✓ Respaldo listo: ${mb} MB`);

// ── Rotación ────────────────────────────────────────────────────────────────
const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
let borrados = 0;
for (const nombre of readdirSync(destino)) {
  if (!nombre.startsWith('supersacos-') || !nombre.endsWith('.dump')) continue;
  const ruta = join(destino, nombre);
  if (statSync(ruta).mtimeMs < limite) {
    unlinkSync(ruta);
    borrados++;
  }
}

const quedan = readdirSync(destino).filter(n => n.endsWith('.dump')).length;
console.log(`✓ Retención de ${dias} días: ${borrados} eliminados, ${quedan} respaldos en la carpeta.`);
