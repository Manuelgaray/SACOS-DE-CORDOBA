import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { cabecerasPdf, etagDe } from '@/compartido/archivo-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/specs/[spec]/pdf — sirve el PDF del diseño guardado en el catálogo.
// El diseño es información sensible: SOLO usuarios autenticados (el visor de la
// app manda el header x-user-email); la URL directa sin sesión responde 401.
export async function GET(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return new Response('No autenticado', { status: 401 });

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();

  // Primero solo los metadatos: el ETag lleva la fecha de actualización, así que
  // si el diseño se reemplaza el navegador lo nota y vuelve a bajarlo.
  const { rows: meta } = await query<{
    bytes: number | null; pdf_mime: string | null; pdf_nombre: string | null; actualizado_en: Date | string;
  }>(
    `SELECT octet_length(pdf_data) AS bytes, pdf_mime, pdf_nombre, actualizado_en
       FROM specs WHERE UPPER(spec) = $1`,
    [spec],
  );
  const m = meta[0];
  if (!m || !m.bytes) return new Response('PDF no encontrado', { status: 404 });

  // El ETag no lleva el spec: puede traer letras fuera de latin-1 y las
  // cabeceras no las admiten. Con tamaño y fecha basta (es único por URL).
  const etag = etagDe('spec', m.bytes, new Date(m.actualizado_en).getTime());
  const cabeceras = cabecerasPdf(m.pdf_mime, m.pdf_nombre || `${spec}.pdf`, etag);

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: cabeceras });
  }

  const { rows } = await query<{ pdf_data: Buffer }>(
    'SELECT pdf_data FROM specs WHERE UPPER(spec) = $1',
    [spec],
  );
  return new Response(new Uint8Array(rows[0].pdf_data), { status: 200, headers: cabeceras });
}
