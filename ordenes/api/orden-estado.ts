import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

const ESTADOS = ['activa', 'programada', 'pausada', 'terminada', 'cancelada'];

// POST /api/ordenes/[id]/estado — cambia el status de una orden. SOLO ADMIN.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo un administrador puede cambiar el estado de una orden' },
      { status: 403 },
    );
  }

  let body: { estado?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const estado = body.estado ?? '';
  if (!ESTADOS.includes(estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }

  const { rowCount } = await query('UPDATE ordenes SET status = $2 WHERE id = $1', [params.id, estado]);
  if (!rowCount) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
