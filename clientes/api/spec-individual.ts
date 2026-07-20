import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { normalizarElementos } from '@/explosion-materiales/explosion';

export const runtime = 'nodejs';

// GET /api/specs/[spec] — información del spec: su cliente y las especificaciones
// de su última orden (tipo de saco, medida, carga, elementos de corte con sus
// medidas, y el PDF). Alimenta el autollenado de "Nueva orden" y el visor de PDF
// en la pantalla Clientes.
export async function GET(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();
  if (!spec) return NextResponse.json({ error: 'Spec inválido' }, { status: 400 });

  // Cliente dueño del spec (según el registro maestro).
  const { rows: regRows } = await query<{ spec: string; cliente: string }>(
    'SELECT spec, cliente FROM specs WHERE UPPER(spec) = $1',
    [spec],
  );
  const registro = regRows[0] ?? null;

  // Última orden de ese spec (la fuente de las especificaciones).
  const { rows: ordRows } = await query<{
    id: string;
    cliente: string;
    tipo_saco: string;
    medida: string;
    carga_lbs: number;
    grado: string | null;
    corte_elementos: unknown;
    has_pdf: boolean;
  }>(
    `SELECT id, cliente, tipo_saco, medida, carga_lbs, grado, corte_elementos,
            (pdf_data IS NOT NULL) AS has_pdf
       FROM ordenes
      WHERE UPPER(TRIM(spec)) = $1
      ORDER BY fecha_creacion DESC
      LIMIT 1`,
    [spec],
  );
  const o = ordRows[0] ?? null;

  if (!registro && !o) {
    return NextResponse.json({ error: 'Spec no encontrado' }, { status: 404 });
  }

  return NextResponse.json({
    spec: registro?.spec ?? spec,
    cliente: registro?.cliente ?? o?.cliente ?? null,
    orden: o
      ? {
          id: o.id,
          tipo_saco: o.tipo_saco,
          medida: o.medida,
          carga_lbs: Number(o.carga_lbs),
          grado: o.grado,
          corte_elementos: o.corte_elementos == null ? null : normalizarElementos(o.corte_elementos),
          pdf_url: o.has_pdf ? `/api/ordenes/${o.id}/pdf` : null,
        }
      : null,
  });
}

// DELETE /api/specs/[spec] — elimina un spec del registro (admin/diseño).
// Las órdenes existentes no se tocan: guardan el spec como texto.
export async function DELETE(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin' && actor.rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();
  const { rowCount } = await query('DELETE FROM specs WHERE UPPER(spec) = $1', [spec]);
  if (!rowCount) {
    return NextResponse.json({ error: 'Spec no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
