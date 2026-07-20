// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de autorización en el SERVIDOR (rutas API, runtime nodejs).
//
//  La sesión del cliente vive en localStorage y manda el header `x-user-email`.
//  Aquí resolvemos ese email contra la tabla `usuarios` para conocer rol/área.
//  No es auth criptográfica (uso de planta local), pero centraliza el chequeo.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';

export interface ActorDB {
  email: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
}

/** Devuelve el usuario que hace la petición (según x-user-email) o null. */
export async function actorDe(req: Request): Promise<ActorDB | null> {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query<ActorDB>(
    'SELECT email, nombre, rol, area_asignada FROM usuarios WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

/** Cuántos administradores hay (para no dejar el sistema sin admin). */
export async function contarAdmins(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    "SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'admin'",
  );
  return Number(rows[0]?.n ?? 0);
}

export const ROLES_VALIDOS = ['admin', 'diseno', 'supervisor'] as const;
export type RolValido = (typeof ROLES_VALIDOS)[number];

export function esRolValido(r: unknown): r is RolValido {
  return typeof r === 'string' && (ROLES_VALIDOS as readonly string[]).includes(r);
}
