import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

const ESTADOS = ['activa', 'programada', 'pausada', 'terminada', 'cancelada'];

// POST /api/ordenes/[id]/estado — cambia el status de una orden.
export async function POST(req: Request, { params }: { params: { id: string } }) {
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
