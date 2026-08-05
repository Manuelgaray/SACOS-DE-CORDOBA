// ─────────────────────────────────────────────────────────────────────────────
//  Crea el PRIMER ADMINISTRADOR en Supabase (cuenta + perfil de planta).
//
//    node scripts/crear-admin.mjs correo@empresa.com "Nombre Apellido" contraseña
//
//  A partir de ahí, ese admin da de alta al resto desde la pantalla Usuarios.
//  Es idempotente: si la cuenta ya existe, solo actualiza el perfil.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));

for (const linea of readFileSync(join(AQUI, '..', '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const [email, nombre, password] = process.argv.slice(2);
if (!email || !nombre || !password) {
  console.error('Uso: node scripts/crear-admin.mjs correo@empresa.com "Nombre Apellido" contraseña');
  process.exit(1);
}
if (password.length < 6) {
  console.error('✗ La contraseña debe tener al menos 6 caracteres.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secreta = process.env.SUPABASE_SECRET_KEY;
// La base destino: por defecto la de Supabase (es donde vive la cuenta).
const conexion = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url || !secreta || !conexion) {
  console.error('✗ Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_DATABASE_URL.');
  process.exit(1);
}

const correo = email.trim().toLowerCase();
const admin = createClient(url, secreta, { auth: { persistSession: false } });

// ── 1. La cuenta en Supabase Auth ───────────────────────────────────────────
const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existente = lista?.users.find(u => u.email?.toLowerCase() === correo);

if (existente) {
  const { error } = await admin.auth.admin.updateUserById(existente.id, { password });
  if (error) { console.error('✗ No se pudo actualizar la contraseña:', error.message); process.exit(1); }
  console.log(`✓ La cuenta ${correo} ya existía: contraseña actualizada.`);
} else {
  const { error } = await admin.auth.admin.createUser({ email: correo, password, email_confirm: true });
  if (error) { console.error('✗ No se pudo crear la cuenta:', error.message); process.exit(1); }
  console.log(`✓ Cuenta ${correo} creada en Supabase Auth.`);
}

// ── 2. El perfil de planta (rol y área) ─────────────────────────────────────
const remota = !/@(localhost|127\.0\.0\.1)[:/]/.test(conexion);
const pool = new pg.Pool({
  connectionString: conexion,
  ssl: remota ? { rejectUnauthorized: false } : undefined,
  max: 1,
});

try {
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, rol, area_asignada)
     VALUES ($1, '', $2, 'admin', NULL)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = 'admin'`,
    [correo, nombre.trim()],
  );
  console.log(`✓ Perfil de administrador listo para ${nombre.trim()}.`);
  console.log('\nYa puedes iniciar sesión en la app con ese correo y contraseña.');
} catch (e) {
  console.error('✗ No se pudo guardar el perfil:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
