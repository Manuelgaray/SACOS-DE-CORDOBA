import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  puedeVerificar, COLS_VERIF, CAMPOS_TEXTO, CAMPOS_BOOL, mapVerif, type FilaVerif,
} from '@/produccion/api/hoja-verif-rawbag';

export const runtime = 'nodejs';

async function ordenDeRenglon(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_verif_rawbag WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-verif-rawbag/[id] — guarda un renglón de verificación.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeVerificar(actor)) {
    return NextResponse.json(
      { error: 'Solo el supervisor de Big (o el admin) captura esta verificación' },
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

  // SET dinámico con la lista blanca de columnas (nada viene del cliente sin filtrar).
  const sets: string[] = [];
  const valores: unknown[] = [params.id];
  for (const c of CAMPOS_TEXTO) {
    valores.push(String(body[c] ?? ''));
    sets.push(`${c} = $${valores.length}`);
  }
  for (const c of CAMPOS_BOOL) {
    valores.push(!!body[c]);
    sets.push(`${c} = $${valores.length}`);
  }

  const { rows } = await query<FilaVerif>(
    `UPDATE hoja_verif_rawbag SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS_VERIF}`,
    valores,
  );

  return NextResponse.json({ renglon: mapVerif(rows[0]) });
}

// DELETE /api/hoja-verif-rawbag/[id] — elimina un renglón de verificación.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeVerificar(actor)) {
    return NextResponse.json(
      { error: 'Solo el supervisor de Big (o el admin) captura esta verificación' },
      { status: 403 },
    );
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_verif_rawbag WHERE id = $1', [params.id]);
  return NextResponse.json({ ok: true });
}
