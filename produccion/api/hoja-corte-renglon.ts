import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import {
  actorHoja, puedeEditarHoja, reglasOrden, sincronizarCorteDesdeHoja,
  mapRenglon, COLS_HOJA, type FilaHoja,
} from '@/produccion/api/hoja-corte-sync';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';

async function ordenDeRenglon(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_corte WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-corte/[id] — edita un renglón de la hoja.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarHoja(actor)) {
    return NextResponse.json({ error: 'Solo el supervisor de corte o el admin capturan la hoja' }, { status: 403 });
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
  const { rows } = await query<FilaHoja>(
    `UPDATE hoja_corte SET
       operador = $2, maquina = $3, hora = $4, rollo = $5, elemento = $6,
       medida_spec = $7, medida_real = $8, material_spec = $9, material_real = $10,
       laminado = $11, diam_spec = $12, diam_real = $13, piezas = $14, firma = $15, pc = $16
     WHERE id = $1
     RETURNING ${COLS_HOJA}`,
    [
      params.id, s('operador'), s('maquina'), s('hora'), s('rollo'), s('elemento'),
      s('medidaSpec'), s('medidaReal'), s('materialSpec'), s('materialReal'),
      !!body.laminado, s('diamSpec'), s('diamReal'),
      Math.max(0, Math.round(Number(body.piezas) || 0)), s('firma'), !!body.pc,
    ],
  );

  const corte = await sincronizarCorteDesdeHoja(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ renglon: mapRenglon(rows[0]), corte, ...cierre });
}

// DELETE /api/hoja-corte/[id] — elimina un renglón de la hoja.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarHoja(actor)) {
    return NextResponse.json({ error: 'Solo el supervisor de corte o el admin capturan la hoja' }, { status: 403 });
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_corte WHERE id = $1', [params.id]);

  const corte = await sincronizarCorteDesdeHoja(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, corte, ...cierre });
}
