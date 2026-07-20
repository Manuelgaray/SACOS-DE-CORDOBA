import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { extraerElementosDePdf, pdfDesdeBase64 } from '@/explosion-materiales/pdf-corte';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // el OCR puede tardar varios segundos

async function rolDe(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string }>('SELECT rol FROM usuarios WHERE email = $1', [email]);
  return rows[0]?.rol;
}

// POST /api/explosion/extraer — lee un PDF enviado en base64 (antes de que la orden
// exista) y devuelve los elementos de corte detectados, con medidas prellenadas
// donde se pudo. NO guarda nada: se usa en "Nueva orden" para revisar/corregir.
export async function POST(req: Request) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const rol = await rolDe(email);
  if (!email || !rol) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (rol !== 'admin' && rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 });
  }

  let body: { pdf_base64?: string; tipo_saco?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const campo = String(body.pdf_base64 ?? '');
  if (!campo) {
    return NextResponse.json({ error: 'Falta el PDF' }, { status: 400 });
  }
  const buf = pdfDesdeBase64(campo);
  if (buf.length === 0) {
    return NextResponse.json({ error: 'El PDF está vacío o es inválido' }, { status: 400 });
  }

  const tipoSaco = String(body.tipo_saco ?? '') || 'U-PANEL';
  const resultado = await extraerElementosDePdf(buf, tipoSaco);
  return NextResponse.json(resultado);
}
