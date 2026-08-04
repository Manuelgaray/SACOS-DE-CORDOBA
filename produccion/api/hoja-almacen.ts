import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaAlmacen, puedeEditarHojaDeAreas, AREAS_HOJA_ALMACEN,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// El formato de salida de materiales lo captura el supervisor de Almacén
// (o el admin).
export const puedeEditarAlmacen = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_ALMACEN);

export const ERROR_PERMISO = 'Solo el supervisor de Almacén (o el admin) captura esta hoja';

export const COLS_HOJA = `
  id, fecha::text AS fecha, cantidad_entregada,
  firma_entrega, firma_recepcion_corte, firma_recepcion_prod,
  firma_recepcion_alm, firma_entrega_corte
`;

export const COLS_MAT = `
  id, hoja_id, material, etiqueta, factura, tag, cantidad, unidad
`;

export interface FilaHojaAlm {
  id: number | string; fecha: string; cantidad_entregada: number | string;
  firma_entrega: string; firma_recepcion_corte: string; firma_recepcion_prod: string;
  firma_recepcion_alm: string; firma_entrega_corte: string;
}

export interface FilaMatAlm {
  id: number | string; hoja_id: number | string;
  material: string; etiqueta: string; factura: string; tag: string;
  cantidad: number | string; unidad: string;
}

export interface FilaConsumoAlm {
  familia: string;
  consumo_esperado: number | string;
  devolucion_real: number | string;
}

export function mapHoja(r: FilaHojaAlm) {
  return {
    id: Number(r.id),
    fecha: String(r.fecha),
    cantidad_entregada: Number(r.cantidad_entregada),
    firma_entrega: r.firma_entrega,
    firma_recepcion_corte: r.firma_recepcion_corte,
    firma_recepcion_prod: r.firma_recepcion_prod,
    firma_recepcion_alm: r.firma_recepcion_alm,
    firma_entrega_corte: r.firma_entrega_corte,
    materiales: [] as ReturnType<typeof mapMaterial>[],
    consumos: [] as ReturnType<typeof mapConsumo>[],
  };
}

export function mapMaterial(r: FilaMatAlm) {
  return {
    id: Number(r.id),
    hoja_id: Number(r.hoja_id),
    material: r.material,
    etiqueta: r.etiqueta,
    factura: r.factura,
    tag: r.tag,
    cantidad: Number(r.cantidad),
    unidad: r.unidad,
  };
}

export function mapConsumo(r: FilaConsumoAlm) {
  return {
    familia: r.familia,
    consumo_esperado: Number(r.consumo_esperado),
    devolucion_real: Number(r.devolucion_real),
  };
}

/** La orden a la que pertenece una hoja (para validar permisos y reglas). */
export async function ordenDeHoja(hojaId: string | number): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_almacen WHERE id = $1',
    [hojaId],
  );
  return rows[0]?.orden_id ?? null;
}

// GET /api/hoja-almacen?orden=ID — todas las entregas de la orden con sus materiales.
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows: hojasRows } = await query<FilaHojaAlm>(
    `SELECT ${COLS_HOJA} FROM hoja_almacen WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );
  const hojas = hojasRows.map(mapHoja);

  if (hojas.length > 0) {
    const ids = hojas.map(h => h.id);
    const porHoja = new Map(hojas.map(h => [h.id, h]));

    const { rows: matRows } = await query<FilaMatAlm>(
      `SELECT ${COLS_MAT} FROM hoja_almacen_material
        WHERE hoja_id = ANY($1::bigint[]) ORDER BY hoja_id, id`,
      [ids],
    );
    for (const m of matRows) porHoja.get(Number(m.hoja_id))?.materiales.push(mapMaterial(m));

    const { rows: consRows } = await query<FilaConsumoAlm & { hoja_id: number | string }>(
      `SELECT hoja_id, familia, consumo_esperado, devolucion_real
         FROM hoja_almacen_consumo WHERE hoja_id = ANY($1::bigint[]) ORDER BY hoja_id, familia`,
      [ids],
    );
    for (const c of consRows) porHoja.get(Number(c.hoja_id))?.consumos.push(mapConsumo(c));
  }

  return NextResponse.json({ hojas });
}

// POST /api/hoja-almacen — abre una entrega nueva.
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarAlmacen(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? '');
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  const fechaTexto = String(body.fecha ?? '');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto) ? fechaTexto : null;

  const { rows } = await query<FilaHojaAlm>(
    `INSERT INTO hoja_almacen (orden_id, fecha, firma_entrega, capturado_por)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $3)
     RETURNING ${COLS_HOJA}`,
    [ordenId, fecha, actor.nombre],
  );

  const avances = await sincronizarDesdeHojaAlmacen(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ hoja: mapHoja(rows[0]), avances, ...cierre }, { status: 201 });
}
