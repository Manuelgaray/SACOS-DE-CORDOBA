// ─────────────────────────────────────────────────────────────────────────────
//  Cliente de Supabase para el SERVIDOR (rutas de API, runtime nodejs).
//
//  Lee la sesión de las cookies y la VERIFICA contra Supabase. Esta es la
//  diferencia de fondo con el esquema anterior: antes el servidor creía en un
//  encabezado que cualquiera podía escribir; ahora comprueba criptográficamente
//  quién hace la petición.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/** Cliente ligado a las cookies de la petición en curso. */
export function supabaseServidor() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !llave) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }

  const almacen = cookies();
  return createServerClient(url, llave, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (nuevas) => {
        // En una ruta de API las cookies son de solo lectura; refrescarlas es
        // trabajo del middleware. Si falla, se ignora sin romper la petición.
        try {
          for (const { name, value, options } of nuevas) almacen.set(name, value, options);
        } catch {
          /* no-op */
        }
      },
    },
  });
}

/**
 * Correo del usuario autenticado, o null. `getUser()` valida el token contra
 * Supabase: no se confía en lo que traiga la cookie sin comprobar.
 */
export async function emailDeSesion(): Promise<string | null> {
  try {
    const { data, error } = await supabaseServidor().auth.getUser();
    if (error || !data.user?.email) return null;
    return data.user.email.trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Cliente con la llave SECRETA: se salta todas las reglas. Solo para tareas de
 * administración (crear usuarios, cambiar contraseñas). Nunca en el navegador.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secreta = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secreta) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.');
  }
  return createClient(url, secreta, { auth: { persistSession: false, autoRefreshToken: false } });
}
