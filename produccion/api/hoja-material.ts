import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaMaterial, puedeEditarHojaDeAreas, AREAS_HOJA_MATERIAL,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La hoja de control de material es compartida: la capturan el supervisor de
// Small, el de Tips o un administrador.
const puedeEditar = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_MATERIAL);

interface FilaMaterial {
  id: number | string;
  descripcion: string;
  entregas: Record<string, number> | null;
  terminado: boolean;
}

function mapFila(r: FilaMaterial) {
  return {
    id: Number(r.id),
    descripcion: r.descripcion,
    entregas: r.entregas ?? {},
    terminado: !!r.terminado,
  };
}

// GET /api/hoja-material?orden=ID — renglones y columnas de fecha (con firmas).
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows: renglones } = await query<FilaMaterial>(
    'SELECT id, descripcion, entregas, terminado FROM hoja_material WHERE orden_id = $1 ORDER BY id',
    [ordenId],
  );
  const { rows: fechas } = await query<{ fecha: string; entrega: string; recibe: string }>(
    `SELECT fecha::text AS fecha, entrega, recibe FROM hoja_material_fecha
      WHERE orden_id = $1 ORDER BY fecha`,
    [ordenId],
  );
  return NextResponse.json({ renglones: renglones.map(mapFila), fechas });
}

// POST /api/hoja-material — agrega un renglón de material (descripción libre).
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Small o Tips (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  let body: { orden_id?: string; descripcion?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? '');
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  const { rows } = await query<FilaMaterial>(
    `INSERT INTO hoja_material (orden_id, descripcion) VALUES ($1, $2)
     RETURNING id, descripcion, entregas, terminado`,
    [ordenId, String(body.descripcion ?? '')],
  );

  return NextResponse.json({ renglon: mapFila(rows[0]) }, { status: 201 });
}

// PUT /api/hoja-material — agrega una columna de fecha o guarda sus firmas.
export async function PUT(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Small o Tips (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  let body: { orden_id?: string; fecha?: string; entrega?: string; recibe?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? '');
  const fecha = String(body.fecha ?? '');
  if (!ordenId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: 'Orden o fecha inválida' }, { status: 400 });
  }

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  const { rows } = await query<{ fecha: string; entrega: string; recibe: string }>(
    `INSERT INTO hoja_material_fecha (orden_id, fecha, entrega, recibe)
     VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (orden_id, fecha) DO UPDATE SET entrega = EXCLUDED.entrega, recibe = EXCLUDED.recibe
     RETURNING fecha::text AS fecha, entrega, recibe`,
    [ordenId, fecha, String(body.entrega ?? ''), String(body.recibe ?? '')],
  );

  return NextResponse.json({ fecha: rows[0] });
}

// DELETE /api/hoja-material?orden=ID&fecha=YYYY-MM-DD — quita una columna de
// fecha (y las piezas capturadas en ella).
export async function DELETE(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Small o Tips (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const ordenId = url.searchParams.get('orden') ?? '';
  const fecha = url.searchParams.get('fecha') ?? '';
  if (!ordenId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: 'Orden o fecha inválida' }, { status: 400 });
  }

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_material_fecha WHERE orden_id = $1 AND fecha = $2::date', [ordenId, fecha]);
  await query('UPDATE hoja_material SET entregas = entregas - $2 WHERE orden_id = $1', [ordenId, fecha]);

  const avances = await sincronizarDesdeHojaMaterial(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
