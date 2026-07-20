import { query } from '@/compartido/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ordenes/[id]/pdf — sirve el PDF guardado en la columna bytea.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { rows } = await query<{ pdf_data: Buffer | null; pdf_mime: string | null; pdf_nombre: string | null }>(
    'SELECT pdf_data, pdf_mime, pdf_nombre FROM ordenes WHERE id = $1',
    [params.id],
  );

  const row = rows[0];
  if (!row || !row.pdf_data) {
    return new Response('PDF no encontrado', { status: 404 });
  }

  const nombre = (row.pdf_nombre || 'orden.pdf').replace(/[\r\n"]/g, '');
  return new Response(new Uint8Array(row.pdf_data), {
    status: 200,
    headers: {
      'Content-Type': row.pdf_mime || 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
