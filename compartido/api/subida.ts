import { NextResponse } from 'next/server';
import { actorDe } from '@/autenticacion/auth-server';
import { urlDeSubida, rutaOrden, rutaSpec, rutaTemporal } from '@/compartido/storage';

export const runtime = 'nodejs';

// POST /api/subida — entrega una URL temporal para que el NAVEGADOR suba el
// PDF directo a Supabase Storage.
//
// El archivo nunca pasa por nuestro servidor: así no le aplica el límite de
// 4.5 MB de Vercel y un plano grande sube sin problema. La URL dura minutos y
// solo se emite después de comprobar que quien la pide puede subir diseños.
export async function POST(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin' && actor.rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para subir diseños' }, { status: 403 });
  }

  let body: { tipo?: string; clave?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const clave = String(body.clave ?? '').trim();

  // La ruta la arma SIEMPRE el servidor: el cliente solo dice de qué se trata.
  // 'temp' es para la orden nueva, cuyo id todavía no existe cuando se sube el
  // plano; al crearla, el servidor mueve el archivo a su lugar definitivo.
  let ruta: string;
  if (body.tipo === 'temp') ruta = rutaTemporal();
  else if (body.tipo === 'orden' && clave) ruta = rutaOrden(clave);
  else if (body.tipo === 'spec' && clave) ruta = rutaSpec(clave);
  else return NextResponse.json({ error: 'Tipo de archivo no válido' }, { status: 400 });

  try {
    const firma = await urlDeSubida(ruta);
    return NextResponse.json(firma);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo preparar la subida' },
      { status: 500 },
    );
  }
}
