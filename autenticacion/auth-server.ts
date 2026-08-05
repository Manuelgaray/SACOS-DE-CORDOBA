// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de autorización en el SERVIDOR (rutas API, runtime nodejs).
//
//  La identidad sale de la SESIÓN DE SUPABASE (cookie firmada), que el servidor
//  verifica contra Supabase en cada petición. Antes se confiaba en el
//  encabezado `x-user-email`, que cualquiera podía escribir: en una red local
//  era discutible, en internet era una puerta abierta.
//
//  El rol y el área siguen viviendo en nuestra tabla `usuarios`, que es la
//  fuente de la verdad de los permisos; Supabase solo dice QUIÉN eres.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';
import { emailDeSesion } from '@/autenticacion/supabase-servidor';

export interface ActorDB {
  email: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
}

/** Perfil (rol y área) de un correo ya autenticado. */
export async function perfilDe(email: string): Promise<ActorDB | null> {
  const { rows } = await query<ActorDB>(
    'SELECT email, nombre, rol, area_asignada FROM usuarios WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

/**
 * Usuario que hace la petición, o null. El parámetro `req` se conserva por
 * compatibilidad con las rutas que ya lo pasaban, pero YA NO se lee de él:
 * la identidad viene de la cookie de sesión.
 */
export async function actorDe(_req?: Request): Promise<ActorDB | null> {
  const email = await emailDeSesion();
  if (!email) return null;
  return perfilDe(email);
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
