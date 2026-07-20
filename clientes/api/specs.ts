import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

// POST /api/specs — registra un spec para un cliente (admin/diseño).
// El spec es ÚNICO E IRREPETIBLE en todo el sistema (se normaliza a mayúsculas).
export async function POST(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin' && actor.rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  let body: { cliente?: string; spec?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const cliente = (body.cliente ?? '').trim();
  const spec = (body.spec ?? '').trim().toUpperCase();
  if (!cliente || !spec) {
    return NextResponse.json({ error: 'Cliente y spec son obligatorios' }, { status: 400 });
  }

  // ¿El spec ya existe (de cualquier cliente)?
  const { rows: existentes } = await query<{ spec: string; cliente: string }>(
    'SELECT spec, cliente FROM specs WHERE UPPER(spec) = $1',
    [spec],
  );
  if (existentes.length > 0) {
    const e = existentes[0];
    return NextResponse.json(
      { error: `El spec ${e.spec} ya está registrado para el cliente ${e.cliente}. Cada spec es único e irrepetible.` },
      { status: 409 },
    );
  }

  try {
    await query('INSERT INTO specs (spec, cliente) VALUES ($1, $2)', [spec, cliente]);
  } catch {
    return NextResponse.json(
      { error: 'No se pudo registrar: verifica que el cliente exista en el registro' },
      { status: 400 },
    );
  }

  return NextResponse.json({ spec: { spec, cliente } }, { status: 201 });
}
