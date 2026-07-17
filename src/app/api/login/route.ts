import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

// POST /api/login  — valida credenciales contra la tabla `usuarios`.
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
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
  }>('SELECT email, password_hash, nombre, rol, area_asignada FROM usuarios WHERE email = $1', [email]);

  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return NextResponse.json({ error: 'Email o contraseña incorrectos' }, { status: 401 });
  }

  // Una sola sesión activa por usuario: generamos un token nuevo y lo guardamos.
  // Cualquier dispositivo con un token anterior dejará de ser válido (se cierra).
  const token = randomUUID();
  await query('UPDATE usuarios SET session_token = $1 WHERE email = $2', [token, u.email]);

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
