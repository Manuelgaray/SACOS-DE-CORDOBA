'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Cliente de Supabase para el NAVEGADOR.
//
//  Solo lleva la llave publicable (está pensada para ser pública). La sesión se
//  guarda en cookies que el navegador manda solas en cada petición a nuestra
//  API — por eso el servidor ya no necesita que le digan quién eres: lo
//  verifica él mismo contra Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { createBrowserClient } from '@supabase/ssr';

let cache: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseNavegador() {
  if (cache) return cache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !llave) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  cache = createBrowserClient(url, llave);
  return cache;
}
