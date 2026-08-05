import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { supabaseAdmin } from '@/autenticacion/supabase-servidor';
import { actorDe, esRolValido, contarAdmins } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

interface UsuarioRow {
  email: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
}

async function buscar(email: string): Promise<UsuarioRow | null> {
  const { rows } = await query<UsuarioRow>(
    'SELECT email, nombre, rol, area_asignada FROM usuarios WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

// PUT /api/usuarios/[email] — el admin edita nombre/rol/área y opcionalmente
// resetea la contraseña de otro usuario.
export async function PUT(req: Request, { params }: { params: { email: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede editar usuarios' }, { status: 403 });
  }

  const email = decodeURIComponent(params.email).trim().toLowerCase();
  const target = await buscar(email);
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  let body: { nombre?: string; rol?: string; area_asignada?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const nombre = (body.nombre ?? target.nombre).trim();
  const rol = body.rol ?? target.rol;
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  }
  if (!esRolValido(rol)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
  }

  // Salvaguarda: no dejar el sistema sin admin (degradar al último admin).
  if (target.rol === 'admin' && rol !== 'admin' && (await contarAdmins()) <= 1) {
    return NextResponse.json(
      { error: 'No puedes quitar el último administrador del sistema' },
      { status: 409 },
    );
  }

  const area = rol === 'supervisor' ? (body.area_asignada || null) : null;
  const password = body.password ?? '';

  // La contraseña vive en Supabase Auth: se cambia allá, no en nuestra tabla.
  if (password) {
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 },
      );
    }
    const error = await cambiarPasswordEnAuth(email, password);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  await query(
    'UPDATE usuarios SET nombre = $2, rol = $3, area_asignada = $4 WHERE email = $1',
    [email, nombre, rol, area],
  );

  const usuario: UsuarioRow = { email, nombre, rol, area_asignada: area };
  return NextResponse.json({ usuario });
}

// DELETE /api/usuarios/[email] — el admin elimina un usuario.
export async function DELETE(req: Request, { params }: { params: { email: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede eliminar usuarios' }, { status: 403 });
  }

  const email = decodeURIComponent(params.email).trim().toLowerCase();
  if (email === actor.email) {
    return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta' }, { status: 400 });
  }

  const target = await buscar(email);
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (target.rol === 'admin' && (await contarAdmins()) <= 1) {
    return NextResponse.json(
      { error: 'No puedes eliminar el último administrador del sistema' },
      { status: 409 },
    );
  }

  // Se borra también la CUENTA en Supabase Auth: si solo quitáramos el perfil,
  // el correo seguiría pudiendo iniciar sesión (aunque sin permisos).
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const cuenta = data?.users.find(u => u.email?.toLowerCase() === email);
  if (cuenta) await admin.auth.admin.deleteUser(cuenta.id);

  await query('DELETE FROM usuarios WHERE email = $1', [email]);
  return NextResponse.json({ ok: true });
}

/** Cambia la contraseña en Supabase Auth. Devuelve el error, o null si salió bien. */
export async function cambiarPasswordEnAuth(email: string, password: string): Promise<string | null> {
  const admin = supabaseAdmin();
  // La API de administración trabaja por id, así que primero se busca el correo.
  const { data, error: errLista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (errLista) return 'No se pudo consultar la cuenta.';
  const cuenta = data.users.find(u => u.email?.toLowerCase() === email);
  if (!cuenta) return 'La cuenta no existe en el sistema de acceso.';
  const { error } = await admin.auth.admin.updateUserById(cuenta.id, { password });
  return error ? error.message : null;
}
