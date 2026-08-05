import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { cabecerasPdf, etagDe } from '@/compartido/archivo-http';
import { urlDeDescarga } from '@/compartido/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/specs/[spec]/pdf — sirve el PDF del diseño guardado en el catálogo.
// El diseño es información sensible: SOLO usuarios autenticados. La identidad
// viaja en la cookie de sesión, que el navegador manda sola; sin ella → 401.
export async function GET(req: Request, { params }: { params: { spec: string } }) {
  const actor = await actorDe(req);
  if (!actor) return new Response('No autenticado', { status: 401 });

  const spec = decodeURIComponent(params.spec).trim().toUpperCase();

  // Primero solo los metadatos: el ETag lleva la fecha de actualización, así que
  // si el diseño se reemplaza el navegador lo nota y vuelve a bajarlo.
  const { rows: meta } = await query<{
    pdf_path: string | null; bytes: number | null;
    pdf_mime: string | null; pdf_nombre: string | null; actualizado_en: Date | string;
  }>(
    `SELECT pdf_path, octet_length(pdf_data) AS bytes, pdf_mime, pdf_nombre, actualizado_en
       FROM specs WHERE UPPER(spec) = $1`,
    [spec],
  );
  const m = meta[0];
  if (!m) return new Response('Spec no encontrado', { status: 404 });

  // El plano vive en Storage: se redirige a una URL firmada y el navegador lo
  // baja directo de Supabase, sin pasar por el límite de tamaño de Vercel.
  if (m.pdf_path) {
    const firmada = await urlDeDescarga(m.pdf_path);
    if (!firmada) return new Response('PDF no encontrado', { status: 404 });
    return Response.redirect(firmada, 307);
  }

  // ── Compatibilidad: diseños cuyo PDF aún vive en la base ───────────────────
  if (!m.bytes) return new Response('PDF no encontrado', { status: 404 });

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
