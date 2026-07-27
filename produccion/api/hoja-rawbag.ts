import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaRawbag, puedeEditarHojaDeAreas, AREAS_HOJA_RAWBAG,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La hoja de Raw Bag y Tapa es compartida: la capturan el supervisor de Big, el
// de Tapa o un administrador.
const puedeEditar = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_RAWBAG);

export interface FilaRawbag {
  id: number | string;
  fecha: string;
  maquina: string;
  operador: string;
  actividad: string;
  p08: number | string;
  p10: number | string;
  p12: number | string;
  p14: number | string;
  observaciones: string;
  terminado: boolean;
}

export const COLS_RAWBAG = `
  id, fecha::text AS fecha, maquina, operador, actividad,
  p08, p10, p12, p14, observaciones, terminado
`;

export function mapRawbag(r: FilaRawbag) {
  return {
    id: Number(r.id),
    fecha: String(r.fecha),
    maquina: r.maquina,
    operador: r.operador,
    actividad: r.actividad,
    p08: Number(r.p08),
    p10: Number(r.p10),
    p12: Number(r.p12),
    p14: Number(r.p14),
    observaciones: r.observaciones,
    terminado: !!r.terminado,
  };
}

// GET /api/hoja-rawbag?orden=ID — renglones de la hoja (todos los días) y las
// actividades marcadas como terminadas.
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaRawbag>(
    `SELECT ${COLS_RAWBAG} FROM hoja_rawbag WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );
  const { rows: acts } = await query<{ actividad: string }>(
    'SELECT actividad FROM hoja_rawbag_actividad WHERE orden_id = $1 AND terminado',
    [ordenId],
  );
  return NextResponse.json({
    renglones: rows.map(mapRawbag),
    terminadas: acts.map(a => a.actividad),
  });
}

// PUT /api/hoja-rawbag — marca (o desmarca) una ACTIVIDAD como terminada. El
// avance de Big y Tapa se calcula con esto, no con los renglones: así da igual
// cuántas hojas se llenen para la misma actividad.
export async function PUT(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Big o Tapa (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  let body: { orden_id?: string; actividad?: string; terminado?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? '');
  const actividad = String(body.actividad ?? '').trim().toUpperCase();
  if (!ordenId || !actividad) {
    return NextResponse.json({ error: 'Falta la orden o la actividad' }, { status: 400 });
  }

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query(
    `INSERT INTO hoja_rawbag_actividad (orden_id, actividad, terminado)
     VALUES ($1, $2, $3)
     ON CONFLICT (orden_id, actividad) DO UPDATE SET terminado = EXCLUDED.terminado`,
    [ordenId, actividad, !!body.terminado],
  );

  const avances = await sincronizarDesdeHojaRawbag(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, actividad, terminado: !!body.terminado, avances, ...cierre });
}

// POST /api/hoja-rawbag — agrega un renglón (operador/máquina/actividad del día).
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Big o Tapa (o el admin) capturan esta hoja' },
      { status: 403 },
    );
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

  const s = (k: string) => String(body[k] ?? '');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(s('fecha')) ? s('fecha') : null;

  const { rows } = await query<FilaRawbag>(
    `INSERT INTO hoja_rawbag (orden_id, fecha, maquina, operador, actividad, capturado_por)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
     RETURNING ${COLS_RAWBAG}`,
    [ordenId, fecha, s('maquina'), s('operador'), s('actividad'), actor.nombre],
  );

  const avances = await sincronizarDesdeHojaRawbag(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ renglon: mapRawbag(rows[0]), avances, ...cierre }, { status: 201 });
}
