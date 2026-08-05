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

const url = process.env.DATABASE_URL!;

// Fuera de la red local (Supabase y cualquier host remoto) la conexión va por
// TLS. En localhost no, porque Postgres de escritorio no lo trae configurado.
const remota = !/@(localhost|127\.0\.0\.1)[:/]/.test(url);

// En serverless cada instancia atiende una petición a la vez: con un pool
// grande por instancia se agotan las conexiones del servidor. En un servidor
// propio (o en desarrollo) sí conviene un pool normal.
const enServerless = !!process.env.VERCEL;

export const pool =
  globalForPg._sacosPool ??
  new Pool({
    connectionString: url,
    max: enServerless ? 1 : 10,
    // El certificado de Supabase lo firma una CA que Node no trae de fábrica;
    // se cifra igual, solo no se valida la cadena.
    ssl: remota ? { rejectUnauthorized: false } : undefined,
    // Serverless: no dejar conexiones ociosas colgadas entre invocaciones.
    idleTimeoutMillis: enServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') globalForPg._sacosPool = pool;

/** Atajo tipado para consultas. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}
