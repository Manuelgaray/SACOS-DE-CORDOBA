import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import { sincronizarDesdeHojaCalidad } from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';
import {
  COLS_CALIDAD, mapCalidad, mesasDeBody, puedeEditarCalidad, ERROR_PERMISO, type FilaCalidad,
} from '@/produccion/api/hoja-calidad';

export const runtime = 'nodejs';

async function ordenDeHoja(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_calidad WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-calidad/[id] — guarda la hoja (turno, supervisor, las 4 mesas
// con su conteo de sacos revisados y las observaciones).
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeHoja(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Hoja no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const mesas = mesasDeBody(body);

  const { rows } = await query<FilaCalidad>(
    `UPDATE hoja_calidad SET
       turno = $2, supervisor = $3, observaciones = $4,
       m1_op1 = $5,  m1_op2 = $6,  m1_activa = $7,  m1_total = $8,
       m2_op1 = $9,  m2_op2 = $10, m2_activa = $11, m2_total = $12,
       m3_op1 = $13, m3_op2 = $14, m3_activa = $15, m3_total = $16,
       m4_op1 = $17, m4_op2 = $18, m4_activa = $19, m4_total = $20
     WHERE id = $1
     RETURNING ${COLS_CALIDAD}`,
    [
      params.id, String(body.turno ?? ''), String(body.supervisor ?? ''),
      String(body.observaciones ?? ''),
      mesas[0].op1, mesas[0].op2, mesas[0].activa, mesas[0].total,
      mesas[1].op1, mesas[1].op2, mesas[1].activa, mesas[1].total,
      mesas[2].op1, mesas[2].op2, mesas[2].activa, mesas[2].total,
      mesas[3].op1, mesas[3].op2, mesas[3].activa, mesas[3].total,
    ],
  );

  const avances = await sincronizarDesdeHojaCalidad(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ hoja: mapCalidad(rows[0]), avances, ...cierre });
}

// DELETE /api/hoja-calidad/[id] — elimina una hoja completa.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeHoja(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Hoja no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_calidad WHERE id = $1', [params.id]);

  const avances = await sincronizarDesdeHojaCalidad(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
