// ─────────────────────────────────────────────────────────────────────────────
//  Conexión a PostgreSQL (solo servidor)
//
//  Este módulo SOLO debe importarse desde código de servidor (route handlers en
//  <modulo>/api/**). Nunca desde un componente "use client": expondría las
//  credenciales y `pg` no corre en el navegador.
//
//  La cadena de conexión vive en .env.local como DATABASE_URL.
// ─────────────────────────────────────────────────────────────────────────────

import { Pool, type QueryResultRow } from 'pg';

if (!process.env.DATABASE_URL) {
  // Falla claro en desarrollo si falta la configuración.
  throw new Error(
    'Falta DATABASE_URL en .env.local. Ejemplo:\n' +
      'DATABASE_URL=postgresql://supersacos_app:TU_PASSWORD@localhost:5432/supersacos',
  );
}

// Reutiliza el pool entre recargas en caliente de Next (evita agotar conexiones).
const globalForPg = globalThis as unknown as { _sacosPool?: Pool };

export const pool =
  globalForPg._sacosPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== 'production') globalForPg._sacosPool = pool;

/** Atajo tipado para consultas. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}
