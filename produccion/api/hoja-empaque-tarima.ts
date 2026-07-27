import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import { sincronizarDesdeHojaEmpaque } from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';
import {
  COLS_EMPAQUE, MAX_TARIMA, mapEmpaque, puedeEditarEmpaque, ERROR_PERMISO, type FilaEmpaque,
} from '@/produccion/api/hoja-empaque';

export const runtime = 'nodejs';

async function ordenDeTarima(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_empaque WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-empaque/[id] — guarda la tarima (fecha, turno, conteo y peso).
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarEmpaque(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeTarima(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Tarima no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const fechaTexto = String(body.fecha ?? '');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto) ? fechaTexto : null;
  const contados = Math.max(0, Math.min(MAX_TARIMA, Math.round(Number(body.contados) || 0)));
  const peso = Math.max(0, Math.round(Number(body.peso) || 0));

  const { rows } = await query<FilaEmpaque>(
    `UPDATE hoja_empaque SET
       fecha = COALESCE($2::date, fecha), turno = $3, contados = $4, peso = $5
     WHERE id = $1
     RETURNING ${COLS_EMPAQUE}`,
    [params.id, fecha, String(body.turno ?? ''), contados, peso],
  );

  const avances = await sincronizarDesdeHojaEmpaque(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ tarima: mapEmpaque(rows[0]), avances, ...cierre });
}

// DELETE /api/hoja-empaque/[id] — elimina una tarima.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarEmpaque(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeTarima(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Tarima no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_empaque WHERE id = $1', [params.id]);

  const avances = await sincronizarDesdeHojaEmpaque(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
