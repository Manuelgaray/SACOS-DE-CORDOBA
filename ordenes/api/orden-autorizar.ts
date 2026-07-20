import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

// POST /api/ordenes/[id]/autorizar — un ADMIN firma la autorización de la orden.
// Queda registrado su nombre y la fecha; una orden solo se autoriza una vez.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede autorizar órdenes' }, { status: 403 });
  }

  const { rows } = await query<{ autorizado_por: string | null }>(
    'SELECT autorizado_por FROM ordenes WHERE id = $1',
    [params.id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }
  if (rows[0].autorizado_por) {
    return NextResponse.json(
      { error: `Esta orden ya fue autorizada por ${rows[0].autorizado_por}` },
      { status: 409 },
    );
  }

  const { rows: upd } = await query<{ autorizado_por: string; fecha_autorizacion: Date }>(
    `UPDATE ordenes SET autorizado_por = $2, fecha_autorizacion = NOW()
      WHERE id = $1
      RETURNING autorizado_por, fecha_autorizacion`,
    [params.id, actor.nombre],
  );

  return NextResponse.json({
    ok: true,
    autorizado_por: upd[0].autorizado_por,
    fecha_autorizacion: new Date(upd[0].fecha_autorizacion).toISOString(),
  });
}
