import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '@/compartido/db';

export const runtime = 'nodejs';

// Sesión única "el primero gana": una sesión se considera ACTIVA si su último
// heartbeat (session_last_seen) tiene menos de este umbral. El heartbeat llega
// cada ~30 s desde la app; el margen extra cubre pestañas en segundo plano
// (los navegadores bajan los timers a ~1/min cuando la pestaña está oculta).
const UMBRAL_SESION_MS = 150_000; // 2.5 minutos

// POST /api/login — valida credenciales. Si la cuenta ya tiene una sesión activa
// en OTRO dispositivo, el login se rechaza (409). El mismo dispositivo (manda su
// `token_actual`) siempre puede volver a entrar.
export async function POST(req: Request) {
  let body: { email?: string; password?: string; token_actual?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 });
  }

  const { rows } = await query<{
    email: string;
    password_hash: string;
    nombre: string;
    rol: string;
    area_asignada: string | null;
    session_token: string | null;
    session_last_seen: Date | string | null;
  }>(
    `SELECT email, password_hash, nombre, rol, area_asignada, session_token, session_last_seen
       FROM usuarios WHERE email = $1`,
    [email],
  );

  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return NextResponse.json({ error: 'Email o contraseña incorrectos' }, { status: 401 });
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

  // Sesión libre (o el mismo dispositivo): emitimos token nuevo y arrancamos el heartbeat.
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
