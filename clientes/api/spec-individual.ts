import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { normalizarElementos } from '@/explosion-materiales/explosion';
import { pdfDeBody, puedeEditarRegistro, type DisenoBody } from '@/clientes/api/specs';

export const runtime = 'nodejs';

interface FilaSpec {
  spec: string;
  cliente: string;
  medida: string;
  carga_lbs: number;
  tipo_saco: string;
  grado: string;
  corte_elementos: unknown;
  has_pdf: boolean;
  pdf_nombre: string | null;
  registrado_por: string | null;
  actualizado_en: Date | string;
}

const COLS_SPEC = `
  spec, cliente, medida, carga_lbs, tipo_saco, grado, corte_elementos,
  (pdf_data IS NOT NULL) AS has_pdf, pdf_nombre, registrado_por, actualizado_en
`;

function mapDiseno(r: FilaSpec) {
  return {
    spec: r.spec,
    cliente: r.cliente,
    tipo_saco: r.tipo_saco,
    medida: r.medida,
    carga_lbs: Number(r.carga_lbs),
    grado: r.grado,
    corte_elementos: r.corte_elementos == null ? null : normalizarElementos(r.corte_elementos),
    pdf_url: r.has_pdf ? `/api/specs/${encodeURIComponent(r.spec)}/pdf` : null,
    pdf_nombre: r.pdf_nombre,
    registrado_por: r.registrado_por,
    actualizado_en: new Date(r.actualizado_en).toISOString(),
  };
}

// GET /api/specs/[spec] — el diseño registrado del saco y, como respaldo, las
// especificaciones de su última orden. Alimenta el autollenado de "Nueva orden"
// y el visor de diseño de la pantalla Clientes.
export async function GET(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();
  if (!spec) return NextResponse.json({ error: 'Spec inválido' }, { status: 400 });

  const { rows: regRows } = await query<FilaSpec>(
    `SELECT ${COLS_SPEC} FROM specs WHERE UPPER(spec) = $1`,
    [spec],
  );
  const registro = regRows[0] ?? null;

  // Última orden del spec: respaldo para specs registrados antes del catálogo.
  const { rows: ordRows } = await query<{
    id: string; cliente: string; tipo_saco: string; medida: string;
    carga_lbs: number; grado: string | null; corte_elementos: unknown;
    has_pdf: boolean; pdf_nombre: string | null;
  }>(
    `SELECT id, cliente, tipo_saco, medida, carga_lbs, grado, corte_elementos,
            (pdf_data IS NOT NULL) AS has_pdf, pdf_nombre
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
    diseno: registro ? mapDiseno(registro) : null,
    orden: o
      ? {
          id: o.id,
          tipo_saco: o.tipo_saco,
          medida: o.medida,
          carga_lbs: Number(o.carga_lbs),
          grado: o.grado,
          corte_elementos: o.corte_elementos == null ? null : normalizarElementos(o.corte_elementos),
          pdf_url: o.has_pdf ? `/api/ordenes/${o.id}/pdf` : null,
          pdf_nombre: o.pdf_nombre,
        }
      : null,
  });
}

// PUT /api/specs/[spec] — actualiza el diseño (admin/diseño). El PDF solo se
// reemplaza si viene uno nuevo: mandar el campo vacío conserva el guardado.
export async function PUT(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarRegistro(actor)) {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();

  let body: DisenoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const pdf = pdfDeBody(String(body.pdf_base64 ?? ''));
  const elementos = body.corte_elementos == null ? null : normalizarElementos(body.corte_elementos);

  const { rows } = await query<FilaSpec>(
    `UPDATE specs SET
       medida          = $2,
       carga_lbs       = $3,
       tipo_saco       = $4,
       grado           = $5,
       corte_elementos = COALESCE($6::jsonb, corte_elementos),
       pdf_data        = COALESCE($7, pdf_data),
       pdf_nombre      = COALESCE($8, pdf_nombre),
       registrado_por  = $9,
       actualizado_en  = now()
     WHERE UPPER(spec) = $1
     RETURNING ${COLS_SPEC}`,
    [
      spec,
      String(body.medida ?? '').trim(),
      parseInt(String(body.carga_lbs ?? ''), 10) || 0,
      String(body.tipo_saco ?? '').trim(),
      String(body.grado ?? '').trim(),
      elementos ? JSON.stringify(elementos) : null,
      pdf,
      pdf ? (String(body.pdf_nombre ?? '').trim() || null) : null,
      actor.nombre,
    ],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Spec no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ diseno: mapDiseno(rows[0]) });
}

// DELETE /api/specs/[spec] — elimina un spec del registro (admin/diseño).
// Las órdenes existentes no se tocan: guardan el spec como texto.
export async function DELETE(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarRegistro(actor)) {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();
  const { rowCount } = await query('DELETE FROM specs WHERE UPPER(spec) = $1', [spec]);
  if (!rowCount) {
    return NextResponse.json({ error: 'Spec no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
