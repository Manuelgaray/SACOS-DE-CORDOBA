import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { rowToOrden, ORDEN_COLS, type OrdenRow } from '@/ordenes/orden-map';
import { avancesDeOrdenes } from '@/produccion/api/avances-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ordenes/[id] — una orden con sus avances.
// El store solo carga el conjunto de trabajo (lo activo y lo reciente), así que
// al abrir una orden vieja del histórico la pantalla la pide por aquí.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { rows } = await query<OrdenRow>(
    `SELECT ${ORDEN_COLS} FROM ordenes WHERE id = $1`,
    [params.id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }

  const orden = rowToOrden(rows[0]);
  const avances = await avancesDeOrdenes([orden.id]);
  return NextResponse.json({ orden, avances: avances[orden.id] ?? [] });
}
