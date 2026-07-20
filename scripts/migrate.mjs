// ─────────────────────────────────────────────────────────────────────────────
//  Migraciones idempotentes de esquema (columnas que se agregaron después).
//
//  Uso:   node scripts/migrate.mjs
//  Lee DATABASE_URL de .env.local. Solo agrega columnas con IF NOT EXISTS, así
//  que es seguro volver a correrlo (no borra ni modifica datos existentes).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

// Lista de migraciones aditivas (idempotentes).
const MIGRACIONES = [
  // Una sola sesión activa por usuario: token de la sesión vigente.
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_token TEXT`,
  // Heartbeat de la sesión: última señal de vida (para liberar sesiones muertas).
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_last_seen TIMESTAMPTZ`,
  // Explosión de materiales del área de corte (por si la base es vieja).
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS corte_elementos JSONB`,
  // Firmas reales: quién elaboró la orden y qué admin la autorizó.
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS elaborado_por TEXT`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS autorizado_por TEXT`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_autorizacion TIMESTAMPTZ`,
  // Registro maestro de clientes y sus productos (specs únicos e irrepetibles).
  `CREATE TABLE IF NOT EXISTS clientes (
     nombre TEXT PRIMARY KEY
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clientes_nombre_lower ON clientes (LOWER(nombre))`,
  `CREATE TABLE IF NOT EXISTS specs (
     spec    TEXT PRIMARY KEY,
     cliente TEXT NOT NULL REFERENCES clientes(nombre) ON UPDATE CASCADE ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS specs_spec_upper ON specs (UPPER(spec))`,
  `CREATE INDEX IF NOT EXISTS specs_cliente ON specs (cliente)`,
  // Precarga: puebla el registro con los clientes/specs de las órdenes existentes.
  `INSERT INTO clientes (nombre)
     SELECT DISTINCT TRIM(cliente) FROM ordenes
      WHERE TRIM(COALESCE(cliente, '')) <> ''
   ON CONFLICT DO NOTHING`,
  `INSERT INTO specs (spec, cliente)
     SELECT DISTINCT ON (UPPER(TRIM(o.spec))) UPPER(TRIM(o.spec)), c.nombre
       FROM ordenes o
       JOIN clientes c ON LOWER(c.nombre) = LOWER(TRIM(o.cliente))
      WHERE TRIM(COALESCE(o.spec, '')) <> ''
   ON CONFLICT DO NOTHING`,
];

// ── Cargar DATABASE_URL desde .env.local ───────────────────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env.local");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]])
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .env.local: confiamos en variables de entorno del sistema */
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("✗ Falta DATABASE_URL (ponlo en .env.local).");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  for (const sql of MIGRACIONES) {
    await pool.query(sql);
    console.log(`✓ ${sql}`);
  }
  console.log(`\nListo: ${MIGRACIONES.length} migraciones aplicadas.`);
} catch (e) {
  console.error("✗ Error aplicando migraciones:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
