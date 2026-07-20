import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';

export const runtime = 'nodejs';

// GET /api/session/check — ¿el token de este dispositivo sigue siendo el vigente?
// Además funciona como HEARTBEAT: cada chequeo válido actualiza session_last_seen,
// que es lo que mantiene la sesión "activa" y bloquea logins en otros dispositivos.
// Si el token ya no coincide (caso raro: sesión obsoleta reemplazada, reset por
// admin), devolvemos { valid: false } para que ese dispositivo cierre su sesión.
export async function GET(req: Request) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const token = req.headers.get('x-session-token') ?? '';

  if (!email || !token) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  // Valida y late en una sola consulta: solo actualiza si el token coincide.
  const { rowCount } = await query(
    'UPDATE usuarios SET session_last_seen = NOW() WHERE email = $1 AND session_token = $2',
    [email, token],
  );

  return NextResponse.json({ valid: !!rowCount }, { status: 200 });
}
