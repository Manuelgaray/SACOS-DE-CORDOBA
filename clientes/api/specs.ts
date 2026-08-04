import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { normalizarElementos } from '@/explosion-materiales/explosion';

export const runtime = 'nodejs';

// Un spec es el DISEÑO de un saco: sus especificaciones, su explosión de
// materiales y el PDF del diseño. Registrarlo aquí adelanta el trabajo — al
// crear una orden con ese spec, todo eso se carga solo.

export interface DisenoBody {
  cliente?: string;
  spec?: string;
  medida?: string;
  carga_lbs?: string | number;
  tipo_saco?: string;
  grado?: string;
  corte_elementos?: unknown;
  pdf_base64?: string;
  pdf_nombre?: string;
}

/** Convierte el PDF que manda el cliente (data URL o base64 puro) a un buffer. */
export function pdfDeBody(pdfField: string): Buffer | null {
  if (!pdfField) return null;
  const coma = pdfField.indexOf(',');
  const raw = coma >= 0 ? pdfField.slice(coma + 1) : pdfField;
  const buf = Buffer.from(raw, 'base64');
  return buf.length > 0 ? buf : null;
}

export function puedeEditarRegistro(actor: { rol: string }): boolean {
  return actor.rol === 'admin' || actor.rol === 'diseno';
}

// POST /api/specs — registra el diseño de un saco (admin/diseño).
// El spec es ÚNICO E IRREPETIBLE en todo el sistema (se normaliza a mayúsculas).
export async function POST(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarRegistro(actor)) {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  let body: DisenoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const cliente = (body.cliente ?? '').trim();
  const spec = (body.spec ?? '').trim().toUpperCase();
  if (!cliente || !spec) {
    return NextResponse.json({ error: 'Cliente y spec son obligatorios' }, { status: 400 });
  }

  // ¿El spec ya existe (de cualquier cliente)?
  const { rows: existentes } = await query<{ spec: string; cliente: string }>(
    'SELECT spec, cliente FROM specs WHERE UPPER(spec) = $1',
    [spec],
  );
  if (existentes.length > 0) {
    const e = existentes[0];
    return NextResponse.json(
      { error: `El spec ${e.spec} ya está registrado para el cliente ${e.cliente}. Cada spec es único e irrepetible.` },
      { status: 409 },
    );
  }

  const pdf = pdfDeBody(String(body.pdf_base64 ?? ''));
  const elementos = body.corte_elementos == null ? null : normalizarElementos(body.corte_elementos);

  try {
    await query(
      `INSERT INTO specs (
         spec, cliente, medida, carga_lbs, tipo_saco, grado,
         corte_elementos, pdf_data, pdf_nombre, registrado_por, actualizado_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, now())`,
      [
        spec, cliente,
        String(body.medida ?? '').trim(),
        parseInt(String(body.carga_lbs ?? ''), 10) || 0,
        String(body.tipo_saco ?? '').trim(),
        String(body.grado ?? '').trim(),
        elementos ? JSON.stringify(elementos) : null,
        pdf,
        String(body.pdf_nombre ?? '').trim() || null,
        actor.nombre,
      ],
    );
  } catch {
    return NextResponse.json(
      { error: 'No se pudo registrar: verifica que el cliente exista en el registro' },
      { status: 400 },
    );
  }

  return NextResponse.json({ spec: { spec, cliente } }, { status: 201 });
}
