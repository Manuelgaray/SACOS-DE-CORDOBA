'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Autenticación
//
//  El login valida las credenciales en el servidor (POST /api/login → tabla
//  `usuarios` de PostgreSQL, con contraseña hasheada). La sesión resultante se
//  guarda en localStorage para mantener la navegación en cliente.
//
//  ⚠ La sesión en localStorage no es una auth "segura" (no hay cookie httpOnly ni
//     protección de ruta en servidor). Suficiente para uso local en la planta.
//
//  Para agregar / cambiar usuarios: edita scripts/seed-users.mjs y vuelve a correr
//  `node scripts/seed-users.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { Area } from '@/compartido/mock-data';

export type Rol = 'admin' | 'diseno' | 'supervisor';

// Etiquetas legibles de cada rol (para la UI).
export const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  diseno: 'Diseño',
  supervisor: 'Supervisor',
};

// Sesión guardada en el navegador (nunca incluye la contraseña).
export interface Sesion {
  email: string;
  nombre: string;
  rol: Rol;
  area_asignada?: string;
  // Token de la sesión vigente (una sola sesión activa por usuario). Si en el
  // servidor el token cambió (otro dispositivo inició sesión), esta deja de valer.
  token?: string;
}

const LS_SESSION = 'sacos.session.v1';

// ─── Acciones ───────────────────────────────────────────────────────────────────

/** Valida credenciales contra el servidor y, si son correctas, guarda la sesión. */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        // Token de este navegador (si hay): permite re-entrar desde el MISMO
        // dispositivo aunque la sesión siga marcada activa en el servidor.
        token_actual: getSession()?.token,
      }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error ?? 'Email o contraseña incorrectos' };
  }

  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(data.sesion as Sesion));
  } catch {
    return { ok: false, error: 'No se pudo guardar la sesión en este navegador' };
  }

  return { ok: true };
}

export function logout() {
  // Liberar la sesión en el servidor (fire-and-forget): así la cuenta queda
  // disponible AL INSTANTE para entrar desde otro dispositivo. `keepalive`
  // deja que la petición sobreviva a la navegación al login.
  const s = getSession();
  if (s?.token) {
    try {
      fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-user-email': s.email, 'x-session-token': s.token },
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* no-op */
    }
  }
  try {
    localStorage.removeItem(LS_SESSION);
  } catch {
    /* no-op */
  }
}

/**
 * Mezcla cambios en la sesión guardada (p. ej. el usuario cambió su nombre en
 * "Mi perfil") y avisa a los componentes que usan useSession en esta pestaña.
 */
export function updateSession(patch: Partial<Sesion>): Sesion | null {
  const cur = getSession();
  if (!cur) return null;
  const next = { ...cur, ...patch };
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(next));
    // El evento 'storage' no se dispara en la misma pestaña: lo emitimos a mano
    // para que el sidebar/topbar reflejen el cambio sin recargar.
    window.dispatchEvent(new StorageEvent('storage', { key: LS_SESSION }));
  } catch {
    /* no-op */
  }
  return next;
}

export function getSession(): Sesion | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_SESSION);
    return raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    return null;
  }
}

/**
 * Pregunta al servidor si esta sesión sigue siendo la vigente (una sola sesión
 * activa por usuario). Devuelve false si el token ya no coincide — es decir, si
 * el usuario inició sesión en otro dispositivo. Ante un error de red devuelve
 * true (no cerramos la sesión por un fallo temporal de conexión).
 */
export async function sesionVigente(sesion: Sesion | null): Promise<boolean> {
  if (!sesion) return false;
  if (!sesion.token) return false; // sesión vieja sin token → requiere re-login
  try {
    const res = await fetch('/api/session/check', {
      method: 'GET',
      headers: {
        'x-user-email': sesion.email,
        'x-session-token': sesion.token,
      },
      cache: 'no-store',
    });
    if (!res.ok) return true; // error del servidor: no cerramos por las dudas
    const data = (await res.json()) as { valid?: boolean };
    return data.valid !== false;
  } catch {
    return true; // sin red: no cerramos la sesión
  }
}

/** Solo el encargado de diseños y el admin pueden subir órdenes nuevas (PDF). */
export function canUpload(rol: Rol | undefined | null): boolean {
  return rol === 'admin' || rol === 'diseno';
}

/**
 * ¿Puede el usuario CAPTURAR (editar avance) en esta área?
 *   admin      → todas las áreas
 *   diseño     → ninguna (solo lectura en todas)
 *   supervisor → solo su área asignada
 * Ver es siempre posible para roles autenticados; aquí solo se gatea la edición.
 */
export function puedeCapturar(sesion: Sesion | null, area: Area): boolean {
  if (!sesion) return false;
  if (sesion.rol === 'admin') return true;
  if (sesion.rol === 'diseno') return false;
  return sesion.area_asignada === area;
}

// ─── Hook de sesión para componentes cliente ────────────────────────────────────
//  Devuelve { sesion, ready }. `ready` es false hasta leer localStorage tras montar
//  (evita parpadeos / desajustes de hidratación).

export function useSession(): { sesion: Sesion | null; ready: boolean } {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSesion(getSession());
    setReady(true);

    // Sincroniza entre pestañas (logout en una cierra las demás)
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_SESSION) setSesion(getSession());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { sesion, ready };
}
