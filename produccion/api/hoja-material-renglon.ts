import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaMaterial, puedeEditarHojaDeAreas, AREAS_HOJA_MATERIAL,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';

const puedeEditar = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_MATERIAL);

async function ordenDeRenglon(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    'SELECT orden_id FROM hoja_material WHERE id = $1',
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

// PUT /api/hoja-material/[id] — guarda la descripción y las piezas por fecha
// de un renglón; el avance de Small/Tips se recalcula al momento.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Small o Tips (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  let body: { descripcion?: string; entregas?: Record<string, unknown>; terminado?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  // Solo fechas válidas con cantidades no negativas.
  const entregas: Record<string, number> = {};
  for (const [f, v] of Object.entries(body.entregas ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
    const n = Math.max(0, Math.round(Number(v) || 0));
    if (n > 0) entregas[f] = n;
  }

  await query(
    'UPDATE hoja_material SET descripcion = $2, entregas = $3::jsonb, terminado = $4 WHERE id = $1',
    [params.id, String(body.descripcion ?? ''), JSON.stringify(entregas), !!body.terminado],
  );

  const avances = await sincronizarDesdeHojaMaterial(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}

// DELETE /api/hoja-material/[id] — elimina un renglón de material.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditar(actor)) {
    return NextResponse.json(
      { error: 'Solo los supervisores de Small o Tips (o el admin) capturan esta hoja' },
      { status: 403 },
    );
  }

  const ordenId = await ordenDeRenglon(params.id);
  if (!ordenId) return NextResponse.json({ error: 'Renglón no encontrado' }, { status: 404 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  await query('DELETE FROM hoja_material WHERE id = $1', [params.id]);

  const avances = await sincronizarDesdeHojaMaterial(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ ok: true, avances, ...cierre });
}
