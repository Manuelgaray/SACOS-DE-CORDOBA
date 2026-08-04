import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { cabecerasPdf, etagDe } from '@/compartido/archivo-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ordenes/[id]/pdf — sirve el PDF guardado en la columna bytea.
// El diseño es información sensible: SOLO usuarios autenticados (el visor de la
// app manda el header x-user-email); la URL directa sin sesión responde 401.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(_req);
  if (!actor) {
    return new Response('No autenticado', { status: 401 });
  }
  // Primero solo el tamaño: sirve de ETag y evita traer los megabytes de la
  // base cuando el navegador ya tiene el PDF en su caché.
  const { rows: meta } = await query<{ bytes: number | null; pdf_mime: string | null; pdf_nombre: string | null }>(
    'SELECT octet_length(pdf_data) AS bytes, pdf_mime, pdf_nombre FROM ordenes WHERE id = $1',
    [params.id],
  );
  const m = meta[0];
  if (!m || !m.bytes) return new Response('PDF no encontrado', { status: 404 });

  const etag = etagDe('orden', m.bytes);
  const cabeceras = cabecerasPdf(m.pdf_mime, m.pdf_nombre || 'orden.pdf', etag);

  if (_req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: cabeceras });
  }

  const { rows } = await query<{ pdf_data: Buffer }>(
    'SELECT pdf_data FROM ordenes WHERE id = $1',
    [params.id],
  );
  return new Response(new Uint8Array(rows[0].pdf_data), { status: 200, headers: cabeceras });
}
