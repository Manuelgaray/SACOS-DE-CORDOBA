import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { query } from '@/compartido/db';
import { emailDeSesion } from '@/autenticacion/supabase-servidor';

export const runtime = 'nodejs';

// Sesión única "el primero gana": una sesión se considera ACTIVA si su último
// heartbeat (session_last_seen) tiene menos de este umbral. El heartbeat llega
// cada ~30 s desde la app; el margen extra cubre pestañas en segundo plano
// (los navegadores bajan los timers a ~1/min cuando la pestaña está oculta).
const UMBRAL_SESION_MS = 150_000; // 2.5 minutos

// POST /api/login — RECLAMA la sesión de la planta.
//
// La contraseña ya la validó Supabase Auth: cuando esta ruta se ejecuta, el
// navegador trae una cookie de sesión verificada. Aquí solo se resuelve el
// perfil (rol y área, que viven en nuestra tabla) y se aplica la regla de UNA
// sesión activa por usuario, que Supabase no cubre por sí solo.
//
// Si la cuenta ya está en uso en otro dispositivo se responde 409 y el cliente
// cierra la sesión de Supabase que acaba de abrir.
export async function POST(req: Request) {
  const email = await emailDeSesion();
  if (!email) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  let body: { token_actual?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* sin cuerpo: se trata como primer inicio en este dispositivo */
  }

  const { rows } = await query<{
    email: string;
    nombre: string;
    rol: string;
    area_asignada: string | null;
    session_token: string | null;
    session_last_seen: Date | string | null;
  }>(
    `SELECT email, nombre, rol, area_asignada, session_token, session_last_seen
       FROM usuarios WHERE email = $1`,
    [email],
  );

  const u = rows[0];
  if (!u) {
    // Existe en Supabase pero no tiene perfil en la planta: sin rol no puede
    // entrar (un administrador debe darlo de alta en Usuarios).
    return NextResponse.json(
      { error: 'Tu cuenta aún no tiene permisos asignados. Pide a un administrador que te dé de alta.' },
      { status: 403 },
    );
  }

  // ¿Hay una sesión activa en otro dispositivo? (token vigente + heartbeat fresco)
  const lastSeen = u.session_last_seen ? new Date(u.session_last_seen).getTime() : 0;
  const sesionActiva = !!u.session_token && Date.now() - lastSeen < UMBRAL_SESION_MS;
  const mismoDispositivo = !!body.token_actual && body.token_actual === u.session_token;

  if (sesionActiva && !mismoDispositivo) {
    return NextResponse.json(
      {
        error:
          'Esta cuenta ya tiene una sesión activa en otro dispositivo. ' +
          'Cierra sesión en ese dispositivo para poder entrar aquí. ' +
          '(Si se apagó sin cerrar sesión, la cuenta se libera sola en un par de minutos.)',
      },
      { status: 409 },
    );
  }

  // Sesión libre (o el mismo dispositivo): token nuevo y arranca el heartbeat.
  const token = randomUUID();
  await query(
    'UPDATE usuarios SET session_token = $1, session_last_seen = NOW() WHERE email = $2',
    [token, u.email],
  );

  return NextResponse.json({
    sesion: {
      email: u.email,
      nombre: u.nombre,
      rol: u.rol,
      area_asignada: u.area_asignada ?? undefined,
      token,
    },
  });
}
