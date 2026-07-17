// ─────────────────────────────────────────────────────────────────────────────
//  Siembra / actualiza los usuarios del sistema con contraseña hasheada (bcrypt).
//
//  Uso:   node scripts/seed-users.mjs
//  Lee DATABASE_URL de .env.local. Es idempotente: actualiza si el email ya existe.
//
//  Para agregar o cambiar usuarios, edita el arreglo USUARIOS de abajo y vuelve a
//  correrlo.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

// ── Usuarios (EDITA AQUÍ) ──────────────────────────────────────────────────────
const USUARIOS = [
  {
    email: "manueljgg2004@gmail.com",
    password: "manu",
    nombre: "Manuel Garay",
    rol: "admin",
  },
  {
    email: "diseno@sacos.com",
    password: "dise",
    nombre: "Encargado de Diseño",
    rol: "diseno",
  },
  // Supervisores por área: cada uno solo puede capturar en su `area_asignada`.
  // Áreas válidas: almacen, corte, small, big, tips, tapa, calidad, empaque.
  {
    email: "corte@sacos.com",
    password: "corte",
    nombre: "Supervisor de Corte",
    rol: "supervisor",
    area_asignada: "corte",
  },
  {
    email: "small@sacos.com",
    password: "small",
    nombre: "Supervisor de Small",
    rol: "supervisor",
    area_asignada: "small",
  },
  {
    email: "tips@sacos.com",
    password: "tips",
    nombre: "Supervisor de Tips",
    rol: "supervisor",
    area_asignada: "tips",
  },
];

// ── Cargar DATABASE_URL desde .env.local (sin dependencias extra) ──────────────
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
  for (const u of USUARIOS) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, area_asignada)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         nombre        = EXCLUDED.nombre,
         rol           = EXCLUDED.rol,
         area_asignada = EXCLUDED.area_asignada`,
      [u.email.toLowerCase(), hash, u.nombre, u.rol, u.area_asignada ?? null],
    );
    console.log(`✓ ${u.email} (${u.rol})`);
  }
  console.log(`\nListo: ${USUARIOS.length} usuarios sembrados.`);
} catch (e) {
  console.error("✗ Error sembrando usuarios:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
