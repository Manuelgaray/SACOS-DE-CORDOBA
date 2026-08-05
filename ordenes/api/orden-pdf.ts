import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { cabecerasPdf, etagDe } from '@/compartido/archivo-http';
import { urlDeDescarga } from '@/compartido/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ordenes/[id]/pdf — entrega el plano de la orden.
//
// El diseño es información sensible: SOLO usuarios autenticados. La identidad
// viaja en la cookie de sesión, que el navegador manda sola; sin ella → 401.
//
// Si el plano está en Supabase Storage (lo normal), NO se transmiten los bytes
// por aquí: se responde con una redirección a una URL firmada de corta vida y
// el navegador lo baja directo. Así el archivo no pasa por nuestro servidor y
// no le aplica el límite de 4.5 MB de Vercel.
//
// Las órdenes anteriores a esa migración conservan el PDF dentro de la base y
// se siguen sirviendo como antes.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(req);
  if (!actor) return new Response('No autenticado', { status: 401 });

  const { rows: meta } = await query<{
    pdf_path: string | null; bytes: number | null;
    pdf_mime: string | null; pdf_nombre: string | null;
  }>(
    `SELECT pdf_path, octet_length(pdf_data) AS bytes, pdf_mime, pdf_nombre
       FROM ordenes WHERE id = $1`,
    [params.id],
  );
  const m = meta[0];
  if (!m) return new Response('Orden no encontrada', { status: 404 });

  if (m.pdf_path) {
    const firmada = await urlDeDescarga(m.pdf_path);
    if (!firmada) return new Response('PDF no encontrado', { status: 404 });
    return Response.redirect(firmada, 307);
  }

  // ── Compatibilidad: PDFs que aún viven en la base ──────────────────────────
  if (!m.bytes) return new Response('PDF no encontrado', { status: 404 });

  const etag = etagDe('orden', m.bytes);
  const cabeceras = cabecerasPdf(m.pdf_mime, m.pdf_nombre || 'orden.pdf', etag);
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: cabeceras });
  }

  const { rows } = await query<{ pdf_data: Buffer }>(
    'SELECT pdf_data FROM ordenes WHERE id = $1',
    [params.id],
  );
  return new Response(new Uint8Array(rows[0].pdf_data), { status: 200, headers: cabeceras });
}
