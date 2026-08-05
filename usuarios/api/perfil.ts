import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { cambiarPasswordEnAuth } from '@/usuarios/api/usuario-individual';

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
    if (nueva.length < 6) {
      return NextResponse.json(
        { error: 'La nueva contraseña debe tener al menos 6 caracteres' },
        { status: 400 },
      );
    }

    // La contraseña actual se comprueba contra Supabase intentando iniciar
    // sesión con ella. Sin esto, a quien dejara la sesión abierta en un equipo
    // le podrían cambiar la contraseña sin conocer la anterior.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const comprobador = createClient(url, llave, { auth: { persistSession: false } });
    const { error: errActual } = await comprobador.auth.signInWithPassword({
      email: actor.email,
      password: body.password_actual ?? '',
    });
    if (errActual) {
      return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 400 });
    }

    const errorCambio = await cambiarPasswordEnAuth(actor.email, nueva);
    if (errorCambio) return NextResponse.json({ error: errorCambio }, { status: 400 });
  }

  await query('UPDATE usuarios SET nombre = $2 WHERE email = $1', [actor.email, nombre]);

  return NextResponse.json({
    usuario: { email: actor.email, nombre, rol: actor.rol, area_asignada: actor.area_asignada },
  });
}
