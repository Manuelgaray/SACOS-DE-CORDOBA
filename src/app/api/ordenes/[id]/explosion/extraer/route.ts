import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extraerElementosDePdf } from '@/lib/pdf-corte';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // el OCR puede tardar varios segundos

async function rolDe(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string }>('SELECT rol FROM usuarios WHERE email = $1', [email]);
  return rows[0]?.rol;
}

// POST /api/ordenes/[id]/explosion/extraer — lee el PDF guardado de la orden y
// devuelve los elementos de corte detectados (con medidas prellenadas donde se
// pudo). NO guarda nada: el usuario revisa/corrige y luego guarda con PUT.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const rol = await rolDe(email);
  if (!email || !rol) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (rol !== 'admin' && rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 });
  }

  const { rows } = await query<{ pdf_data: Buffer | null; tipo_saco: string }>(
    'SELECT pdf_data, tipo_saco FROM ordenes WHERE id = $1',
    [params.id],
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }
  if (!row.pdf_data) {
    return NextResponse.json({ error: 'La orden no tiene PDF para leer' }, { status: 400 });
  }

  const buf = Buffer.isBuffer(row.pdf_data) ? row.pdf_data : Buffer.from(row.pdf_data);
  const resultado = await extraerElementosDePdf(buf, row.tipo_saco);
  return NextResponse.json(resultado);
}
