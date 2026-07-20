import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/compartido/db';
import { actorDe, esRolValido } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

interface UsuarioPublico {
  email: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
}

// GET /api/usuarios — lista de usuarios (solo admin). Nunca devuelve contraseñas.
export async function GET(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede ver los usuarios' }, { status: 403 });
  }

  const { rows } = await query<UsuarioPublico>(
    'SELECT email, nombre, rol, area_asignada FROM usuarios ORDER BY rol, nombre',
  );
  return NextResponse.json({ usuarios: rows });
}

// POST /api/usuarios — crea un usuario (solo admin).
export async function POST(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede crear usuarios' }, { status: 403 });
  }

  let body: { email?: string; password?: string; nombre?: string; rol?: string; area_asignada?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const nombre = (body.nombre ?? '').trim();
  const rol = body.rol ?? '';

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
  }
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  }
  if (!esRolValido(rol)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 4 caracteres' }, { status: 400 });
  }

  const area = rol === 'supervisor' ? (body.area_asignada || null) : null;
  const hash = await bcrypt.hash(password, 10);

  const { rowCount } = await query(
    `INSERT INTO usuarios (email, password_hash, nombre, rol, area_asignada)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    [email, hash, nombre, rol, area],
  );

  if (!rowCount) {
    return NextResponse.json({ error: 'Ya existe un usuario con ese email' }, { status: 409 });
  }

  const usuario: UsuarioPublico = { email, nombre, rol, area_asignada: area };
  return NextResponse.json({ usuario }, { status: 201 });
}
