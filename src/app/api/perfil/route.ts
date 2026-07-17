import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { actorDe } from '@/lib/auth-server';

export const runtime = 'nodejs';

// PUT /api/perfil — el propio usuario cambia su nombre y/o su contraseña.
// No puede cambiar su rol, su área ni su email (eso es identidad/seguridad).
export async function PUT(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: { nombre?: string; password_actual?: string; password_nueva?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const nombre = (body.nombre ?? actor.nombre).trim();
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  }

  const quiereCambiarPass = !!(body.password_nueva && body.password_nueva.length > 0);

  if (quiereCambiarPass) {
    const nueva = body.password_nueva ?? '';
    if (nueva.length < 4) {
      return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' }, { status: 400 });
    }
    // Verificar la contraseña actual antes de cambiarla.
    const { rows } = await query<{ password_hash: string }>(
      'SELECT password_hash FROM usuarios WHERE email = $1',
      [actor.email],
    );
    const hashActual = rows[0]?.password_hash ?? '';
    const ok = await bcrypt.compare(body.password_actual ?? '', hashActual);
    if (!ok) {
      return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 400 });
    }
    const nuevoHash = await bcrypt.hash(nueva, 10);
    await query('UPDATE usuarios SET nombre = $2, password_hash = $3 WHERE email = $1', [
      actor.email,
      nombre,
      nuevoHash,
    ]);
  } else {
    await query('UPDATE usuarios SET nombre = $2 WHERE email = $1', [actor.email, nombre]);
  }

  return NextResponse.json({
    usuario: { email: actor.email, nombre, rol: actor.rol, area_asignada: actor.area_asignada },
  });
}
