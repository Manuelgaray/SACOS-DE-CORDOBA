import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { emailDeSesion } from '@/autenticacion/supabase-servidor';

export const runtime = 'nodejs';

// POST /api/logout — libera la sesión en el servidor (sesión única "el primero
// gana"): al cerrar sesión, la cuenta queda disponible AL INSTANTE para entrar
// desde otro dispositivo, sin esperar a que el heartbeat caduque.
// Solo limpia si el token coincide (no puedes cerrar la sesión de otro).
export async function POST(req: Request) {
  // Quién eres lo dice la sesión de Supabase; el token identifica el dispositivo.
  const email = await emailDeSesion();
  const token = req.headers.get('x-session-token') ?? '';

  if (email && token) {
    await query(
      `UPDATE usuarios SET session_token = NULL, session_last_seen = NULL
        WHERE email = $1 AND session_token = $2`,
      [email, token],
    );
  }

  // Siempre ok: cerrar sesión en el cliente no debe fallar por el servidor.
  return NextResponse.json({ ok: true });
}
