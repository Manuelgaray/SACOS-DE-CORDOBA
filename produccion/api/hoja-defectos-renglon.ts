import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import { puedeEditarCalidad, ERROR_PERMISO } from '@/produccion/api/hoja-calidad';
import {
  COLS_DEFECTOS, CAMPOS_DEFECTO, mapDefecto, type FilaDefecto,
} from '@/produccion/api/hoja-defectos';

export const runtime = 'nodejs';

async function ordenDeRenglon(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_defectos WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-defectos/[id] — guarda un hallazgo.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
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

  // SET dinámico con la lista blanca de columnas (nada viene del cliente sin filtrar).
  const sets: string[] = [];
  const valores: unknown[] = [params.id];
  for (const c of CAMPOS_DEFECTO) {
    valores.push(String(body[c] ?? ''));
    sets.push(`${c} = $${valores.length}`);
  }

  const { rows } = await query<FilaDefecto>(
    `UPDATE hoja_defectos SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS_DEFECTOS}`,
    valores,
  );

  return NextResponse.json({ renglon: mapDefecto(rows[0]) });
}

// DELETE /api/hoja-defectos/[id] — elimina un hallazgo.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_defectos WHERE id = $1', [params.id]);
  return NextResponse.json({ ok: true });
}
