import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import { sincronizarDesdeHojaAlmacen } from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';
import {
  COLS_HOJA, mapHoja, ordenDeHoja, puedeEditarAlmacen, ERROR_PERMISO, type FilaHojaAlm,
} from '@/produccion/api/hoja-almacen';

export const runtime = 'nodejs';

// PUT /api/hoja-almacen/[id] — guarda el encabezado de la entrega (fecha,
// sacos cubiertos y firmas).
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarAlmacen(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeHoja(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Entrega no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const s = (k: string) => String(body[k] ?? '');
  const fechaTexto = s('fecha');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto) ? fechaTexto : null;

  const { rows } = await query<FilaHojaAlm>(
    `UPDATE hoja_almacen SET
       fecha = COALESCE($2::date, fecha),
       cantidad_entregada = $3,
       firma_entrega = $4, firma_recepcion_corte = $5, firma_recepcion_prod = $6,
       firma_recepcion_alm = $7, firma_entrega_corte = $8
     WHERE id = $1
     RETURNING ${COLS_HOJA}`,
    [
      params.id, fecha,
      Math.max(0, Math.round(Number(body.cantidad_entregada) || 0)),
      s('firma_entrega'), s('firma_recepcion_corte'), s('firma_recepcion_prod'),
      s('firma_recepcion_alm'), s('firma_entrega_corte'),
    ],
  );

  const avances = await sincronizarDesdeHojaAlmacen(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ hoja: mapHoja(rows[0]), avances, ...cierre });
}

// DELETE /api/hoja-almacen/[id] — elimina la entrega (y sus renglones).
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarAlmacen(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeHoja(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Entrega no encontrada' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_almacen WHERE id = $1', [params.id]);

  const avances = await sincronizarDesdeHojaAlmacen(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
