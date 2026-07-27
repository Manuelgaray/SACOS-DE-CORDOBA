import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import {
  actorHoja, puedeEditarHoja, reglasOrden, sincronizarCorteDesdeHoja,
  mapRenglon, COLS_HOJA, type FilaHoja,
} from '@/produccion/api/hoja-corte-sync';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hoja-corte?orden=ID — todos los renglones de la hoja de esa orden
// (todas las fechas). Cualquier usuario autenticado puede consultarla.
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const url = new URL(req.url);
  const ordenId = url.searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaHoja>(
    `SELECT ${COLS_HOJA} FROM hoja_corte WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );

  return NextResponse.json({ renglones: rows.map(mapRenglon) });
}

// POST /api/hoja-corte — agrega un renglón (corrida de corte) a la hoja.
// Solo admin o el supervisor de corte; la orden debe estar activa y autorizada.
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarHoja(actor)) {
    return NextResponse.json({ error: 'Solo el supervisor de corte o el admin capturan la hoja' }, { status: 403 });
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

  const { rows } = await query<FilaHoja>(
    `INSERT INTO hoja_corte (
       orden_id, fecha, operador, maquina, hora, rollo, elemento,
       medida_spec, medida_real, material_spec, material_real, laminado,
       diam_spec, diam_real, piezas, firma, pc, capturado_por
     ) VALUES (
       $1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18
     )
     RETURNING ${COLS_HOJA}`,
    [
      ordenId, fecha, s('operador'), s('maquina'), s('hora'), s('rollo'), s('elemento'),
      s('medidaSpec'), s('medidaReal'), s('materialSpec'), s('materialReal'), !!body.laminado,
      s('diamSpec'), s('diamReal'), Math.max(0, Math.round(Number(body.piezas) || 0)),
      s('firma'), !!body.pc, actor.nombre,
    ],
  );

  const corte = await sincronizarCorteDesdeHoja(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ renglon: mapRenglon(rows[0]), corte, ...cierre }, { status: 201 });
}
