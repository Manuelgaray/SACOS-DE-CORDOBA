import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import { puedeEditarCalidad, ERROR_PERMISO } from '@/produccion/api/hoja-calidad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const COLS_DEFECTOS = `
  id, fecha::text AS fecha, turno, mesa, etiqueta, maquina, operador, defecto, resultado
`;

export const CAMPOS_DEFECTO = [
  'turno', 'mesa', 'etiqueta', 'maquina', 'operador', 'defecto', 'resultado',
] as const;

export type FilaDefecto = Record<string, unknown> & { id: number | string; fecha: string };

export function mapDefecto(r: FilaDefecto) {
  const out: Record<string, unknown> = { id: Number(r.id), fecha: String(r.fecha) };
  for (const c of CAMPOS_DEFECTO) out[c] = String(r[c] ?? '');
  return out;
}

// GET /api/hoja-defectos?orden=ID — hallazgos de la orden (todos los días).
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaDefecto>(
    `SELECT ${COLS_DEFECTOS} FROM hoja_defectos WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );
  return NextResponse.json({ renglones: rows.map(mapDefecto) });
}

// POST /api/hoja-defectos — agrega un hallazgo.
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
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

  const { rows } = await query<FilaDefecto>(
    `INSERT INTO hoja_defectos (orden_id, fecha, turno, capturado_por)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4)
     RETURNING ${COLS_DEFECTOS}`,
    [ordenId, fecha, String(body.turno ?? ''), actor.nombre],
  );

  return NextResponse.json({ renglon: mapDefecto(rows[0]) }, { status: 201 });
}
