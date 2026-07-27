import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaRawbag, puedeEditarHojaDeAreas, AREAS_HOJA_RAWBAG,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';
import { COLS_RAWBAG, mapRawbag, type FilaRawbag } from '@/produccion/api/hoja-rawbag';

export const runtime = 'nodejs';

const puedeEditar = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_RAWBAG);

async function ordenDeRenglon(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_rawbag WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-rawbag/[id] — guarda el renglón (producción por bloque de horario,
// observaciones y el check de operación terminada).
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Big o Tapa (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const s = (k: string) => String(body[k] ?? '');
  const n = (k: string) => Math.max(0, Math.round(Number(body[k]) || 0));

  const { rows } = await query<FilaRawbag>(
    `UPDATE hoja_rawbag SET
       maquina = $2, operador = $3, actividad = $4,
       p08 = $5, p10 = $6, p12 = $7, p14 = $8,
       observaciones = $9, terminado = $10
     WHERE id = $1
     RETURNING ${COLS_RAWBAG}`,
    [
      params.id, s('maquina'), s('operador'), s('actividad'),
      n('p08'), n('p10'), n('p12'), n('p14'),
      s('observaciones'), !!body.terminado,
    ],
  );

  const avances = await sincronizarDesdeHojaRawbag(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ renglon: mapRawbag(rows[0]), avances, ...cierre });
}

// DELETE /api/hoja-rawbag/[id] — elimina un renglón de la hoja.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Big o Tapa (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_rawbag WHERE id = $1', [params.id]);

  const avances = await sincronizarDesdeHojaRawbag(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
