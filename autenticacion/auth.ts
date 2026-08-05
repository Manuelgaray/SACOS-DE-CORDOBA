'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Autenticación
//
//  La contraseña la valida SUPABASE AUTH y la sesión vive en cookies firmadas
//  que el servidor verifica en cada petición. Ese es el mecanismo de seguridad.
//
//  En localStorage solo queda una COPIA del perfil (nombre, rol, área y el
//  token de sesión única) para que la interfaz sepa qué mostrar sin consultar
//  al servidor en cada render. No es una credencial: manipularla no da acceso
//  a nada, porque el servidor nunca la lee.
//
//  Los usuarios se administran desde la pantalla Usuarios (solo admin).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { Area } from '@/compartido/mock-data';
import { supabaseNavegador } from '@/autenticacion/supabase-cliente';

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

/**
 * Inicia sesión. La contraseña la valida SUPABASE (no viaja a nuestra API), y
 * la sesión queda en cookies firmadas que el servidor verifica en cada
 * petición. Después se reclama la sesión de planta, que aplica la regla de un
 * solo dispositivo por cuenta y resuelve el rol y el área.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = supabaseNavegador();

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    const credencialesMal = /invalid login credentials/i.test(error.message);
    return {
      ok: false,
      error: credencialesMal ? 'Email o contraseña incorrectos' : error.message,
    };
  }

  let res: Response;
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Token de este navegador (si hay): permite re-entrar desde el MISMO
      // dispositivo aunque la sesión siga marcada activa en el servidor.
      body: JSON.stringify({ token_actual: getSession()?.token }),
    });
  } catch {
    await supabase.auth.signOut();
    return { ok: false, error: 'No se pudo conectar con el servidor' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // La cuenta existe pero no puede entrar (otra sesión activa, o sin perfil):
    // se deshace el inicio de sesión para no dejarla a medias.
    await supabase.auth.signOut();
    return { ok: false, error: data?.error ?? 'No se pudo iniciar sesión' };
  }

  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(data.sesion as Sesion));
  } catch {
    return { ok: false, error: 'No se pudo guardar la sesión en este navegador' };
  }

  return { ok: true };
}

export async function logout() {
  // Liberar la sesión de planta: así la cuenta queda disponible AL INSTANTE
  // para entrar desde otro dispositivo, sin esperar a que caduque el heartbeat.
  const s = getSession();
  if (s?.token) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-token': s.token },
        keepalive: true,
      });
    } catch {
      /* no-op */
    }
  }
  try {
    localStorage.removeItem(LS_SESSION);
  } catch {
    /* no-op */
  }
  // Y cerrar la sesión de Supabase (borra las cookies).
  try {
    await supabaseNavegador().auth.signOut();
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
      headers: { 'x-session-token': sesion.token },
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
