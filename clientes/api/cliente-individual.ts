import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

function sinPermiso(rol: string) {
  return rol !== 'admin' && rol !== 'diseno';
}

// PUT /api/clientes/[nombre] — renombra un cliente (admin/diseño). El FK con
// ON UPDATE CASCADE arrastra el cambio a sus specs automáticamente.
export async function PUT(req: Request, { params }: { params: { nombre: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (sinPermiso(actor.rol)) {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  const nombreActual = decodeURIComponent(params.nombre).trim();

  let body: { nombre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const nombreNuevo = (body.nombre ?? '').trim();
  if (!nombreNuevo) {
    return NextResponse.json({ error: 'El nombre del cliente es obligatorio' }, { status: 400 });
  }

  try {
    const { rowCount } = await query(
      'UPDATE clientes SET nombre = $2 WHERE nombre = $1',
      [nombreActual, nombreNuevo],
    );
    if (!rowCount) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: 'Ya existe otro cliente con ese nombre' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, nombre: nombreNuevo });
}

// DELETE /api/clientes/[nombre] — elimina un cliente y (por cascada) sus specs.
// Las órdenes existentes no se tocan: guardan el nombre como texto.
export async function DELETE(req: Request, { params }: { params: { nombre: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (sinPermiso(actor.rol)) {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  const nombre = decodeURIComponent(params.nombre).trim();
  const { rowCount } = await query('DELETE FROM clientes WHERE nombre = $1', [nombre]);
  if (!rowCount) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
