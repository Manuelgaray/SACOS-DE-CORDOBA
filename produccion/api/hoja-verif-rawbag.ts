import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La verificación de área de Raw Bag la lleva SOLO Big (o un administrador).
export function puedeVerificar(actor: { rol: string; area_asignada: string | null }): boolean {
  return actor.rol === 'admin' || (actor.rol === 'supervisor' && actor.area_asignada === 'big');
}

export const COLS_VERIF = `
  id, fecha::text AS fecha, operador, hora, puntadas, hilos,
  medida_spec, medida_real,
  loop_libre_spec, loop_traslape_spec, loop_costurado_spec, loop_color_spec,
  loop_libre_real, loop_traslape_real, loop_costurado_real, loop_color_real,
  diam_spec, diam_real, material_spec, material_real,
  filler1, filler2, folt, pc, observaciones
`;

// Campos de texto editables (mismo nombre en la base y en el cliente).
export const CAMPOS_TEXTO = [
  'operador', 'hora', 'puntadas', 'hilos',
  'medida_spec', 'medida_real',
  'loop_libre_spec', 'loop_traslape_spec', 'loop_costurado_spec', 'loop_color_spec',
  'loop_libre_real', 'loop_traslape_real', 'loop_costurado_real', 'loop_color_real',
  'diam_spec', 'diam_real', 'material_spec', 'material_real', 'observaciones',
] as const;

export const CAMPOS_BOOL = ['filler1', 'filler2', 'folt', 'pc'] as const;

export type FilaVerif = Record<string, unknown> & { id: number | string; fecha: string };

export function mapVerif(r: FilaVerif) {
  const out: Record<string, unknown> = { id: Number(r.id), fecha: String(r.fecha) };
  for (const c of CAMPOS_TEXTO) out[c] = String(r[c] ?? '');
  for (const c of CAMPOS_BOOL) out[c] = !!r[c];
  return out;
}

// GET /api/hoja-verif-rawbag?orden=ID — verificaciones de la orden (todos los días).
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaVerif>(
    `SELECT ${COLS_VERIF} FROM hoja_verif_rawbag WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );
  return NextResponse.json({ renglones: rows.map(mapVerif) });
}

// POST /api/hoja-verif-rawbag — agrega un renglón de verificación.
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeVerificar(actor)) {
    return NextResponse.json(
      { error: 'Solo el supervisor de Big (o el admin) captura esta verificación' },
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

  // Los valores de especificación se heredan de la orden (medida, material…).
  const { rows } = await query<FilaVerif>(
    `INSERT INTO hoja_verif_rawbag (
       orden_id, fecha, operador, hora, medida_spec, material_spec,
       loop_libre_spec, loop_traslape_spec, loop_costurado_spec, loop_color_spec,
       diam_spec, capturado_por
     ) VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${COLS_VERIF}`,
    [
      ordenId, fecha, s('operador'), s('hora'), s('medida_spec'), s('material_spec'),
      s('loop_libre_spec'), s('loop_traslape_spec'), s('loop_costurado_spec'), s('loop_color_spec'),
      s('diam_spec'), actor.nombre,
    ],
  );

  return NextResponse.json({ renglon: mapVerif(rows[0]) }, { status: 201 });
}
