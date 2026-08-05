// ─────────────────────────────────────────────────────────────────────────────
//  Middleware: mantiene viva la sesión de Supabase.
//
//  El token de acceso caduca a la hora. Este middleware lo refresca en cada
//  navegación y reescribe las cookies, para que a un supervisor no se le cierre
//  la sesión a media captura.
//
//  No decide permisos: eso lo hace cada ruta de API contra la tabla `usuarios`.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  let respuesta = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !llave) return respuesta;

  const supabase = createServerClient(url, llave, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (nuevas) => {
        for (const { name, value } of nuevas) req.cookies.set(name, value);
        respuesta = NextResponse.next({ request: req });
        for (const { name, value, options } of nuevas) {
          respuesta.cookies.set(name, value, options);
        }
      },
    },
  });

  // Con esto se dispara el refresco si el token está por caducar.
  await supabase.auth.getUser();

  return respuesta;
}

export const config = {
  // Todo menos estáticos e imágenes: no tiene sentido refrescar en cada icono.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|pdf.worker.min.mjs).*)'],
};
