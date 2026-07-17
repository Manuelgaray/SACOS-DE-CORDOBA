import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/session/check — ¿el token de este dispositivo sigue siendo el vigente?
// Una sola sesión activa por usuario: si otro dispositivo inició sesión, el token
// guardado cambió y aquí devolvemos { valid: false } para cerrar esta sesión.
export async function GET(req: Request) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const token = req.headers.get('x-session-token') ?? '';

  if (!email || !token) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  const { rows } = await query<{ session_token: string | null }>(
    'SELECT session_token FROM usuarios WHERE email = $1',
    [email],
  );

  const actual = rows[0]?.session_token ?? null;
  const valid = !!actual && actual === token;

  return NextResponse.json({ valid }, { status: 200 });
}
