import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  COLS_MAT, mapMaterial, mapConsumo, ordenDeHoja, puedeEditarAlmacen, ERROR_PERMISO,
  type FilaMatAlm, type FilaConsumoAlm,
} from '@/produccion/api/hoja-almacen';

export const runtime = 'nodejs';

// Los renglones de material no mueven el avance del área (ese sale de los sacos
// cubiertos por la entrega), así que aquí no hay sincronización ni cierre.

const CAMPOS_TEXTO = ['material', 'etiqueta', 'factura', 'tag', 'unidad'] as const;

async function ordenDeMaterial(id: string): Promise<string | null> {
  const { rows } = await query<{ orden_id: string }>(
    `SELECT h.orden_id FROM hoja_almacen_material m
       JOIN hoja_almacen h ON h.id = m.hoja_id
      WHERE m.id = $1`,
    [id],
  );
  return rows[0]?.orden_id ?? null;
}

/** Valida sesión, permiso y reglas de la orden. Devuelve el error o null. */
async function revisar(req: Request, ordenId: string | null) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarAlmacen(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }
  if (!ordenId) return NextResponse.json({ error: 'Entrega no encontrada' }, { status: 404 });
  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });
  return null;
}

// POST /api/hoja-almacen/material — agrega un rollo a una entrega.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const hojaId = String(body.hoja_id ?? '');
  const error = await revisar(req, hojaId ? await ordenDeHoja(hojaId) : null);
  if (error) return error;

  const { rows } = await query<FilaMatAlm>(
    `INSERT INTO hoja_almacen_material (hoja_id) VALUES ($1) RETURNING ${COLS_MAT}`,
    [hojaId],
  );
  return NextResponse.json({ material: mapMaterial(rows[0]) }, { status: 201 });
}

// PUT /api/hoja-almacen/material/[id] — guarda un rollo.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const error = await revisar(req, await ordenDeMaterial(params.id));
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  // SET dinámico con lista blanca: nada del cliente entra sin filtrar.
  const sets: string[] = [];
  const valores: unknown[] = [params.id];
  for (const c of CAMPOS_TEXTO) {
    valores.push(String(body[c] ?? ''));
    sets.push(`${c} = $${valores.length}`);
  }
  valores.push(Math.max(0, Number(body.cantidad) || 0));
  sets.push(`cantidad = $${valores.length}`);

  const { rows } = await query<FilaMatAlm>(
    `UPDATE hoja_almacen_material SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS_MAT}`,
    valores,
  );
  return NextResponse.json({ material: mapMaterial(rows[0]) });
}

// DELETE /api/hoja-almacen/material/[id] — quita un rollo.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const error = await revisar(req, await ordenDeMaterial(params.id));
  if (error) return error;

  await query('DELETE FROM hoja_almacen_material WHERE id = $1', [params.id]);
  return NextResponse.json({ ok: true });
}

// ─── Consumo por familia ──────────────────────────────────────────────────────
// PUT /api/hoja-almacen/[id]/consumo — guarda consumo y devolución de UNA
// familia. La cantidad entregada no se manda: es la suma de los rollos.
export async function PUT_CONSUMO(req: Request, { params }: { params: { id: string } }) {
  const error = await revisar(req, await ordenDeHoja(params.id));
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const familia = String(body.familia ?? '').trim().toUpperCase();
  if (!familia) return NextResponse.json({ error: 'Falta la familia' }, { status: 400 });

  const { rows } = await query<FilaConsumoAlm>(
    `INSERT INTO hoja_almacen_consumo (hoja_id, familia, consumo_esperado, devolucion_real)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (hoja_id, familia) DO UPDATE
       SET consumo_esperado = EXCLUDED.consumo_esperado,
           devolucion_real  = EXCLUDED.devolucion_real
     RETURNING familia, consumo_esperado, devolucion_real`,
    [
      params.id, familia,
      Math.max(0, Number(body.consumo_esperado) || 0),
      Math.max(0, Number(body.devolucion_real) || 0),
    ],
  );
  return NextResponse.json({ consumo: mapConsumo(rows[0]) });
}
