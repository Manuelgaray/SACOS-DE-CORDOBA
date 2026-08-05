// ─────────────────────────────────────────────────────────────────────────────
//  Subida de PDFs desde el NAVEGADOR (cliente).
//
//  El archivo NO pasa por nuestro servidor: se pide una URL firmada y el
//  navegador escribe directo en Supabase Storage. Así un plano de 8 MB sube sin
//  toparse con el límite de 4.5 MB de las funciones de Vercel.
//
//  Devuelve la RUTA dentro del bucket, que es lo que se guarda en la base.
// ─────────────────────────────────────────────────────────────────────────────

import { getSession } from '@/autenticacion/auth';

/** Destino del archivo. 'temp' = orden nueva, cuyo id aún no existe. */
export type DestinoPdf =
  | { tipo: 'temp' }
  | { tipo: 'orden'; clave: string }
  | { tipo: 'spec'; clave: string };

export async function subirPdf(archivo: File, destino: DestinoPdf): Promise<string> {
  const email = getSession()?.email ?? '';

  // 1. El servidor comprueba la sesión y arma la ruta (el cliente nunca la elige).
  const res = await fetch('/api/subida', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(destino),
  });
  const firma = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(firma?.error ?? 'No se pudo preparar la subida.');

  // 2. El navegador escribe directo en Supabase con esa URL temporal.
  const subida = await fetch(firma.url as string, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: archivo,
  });
  if (!subida.ok) {
    throw new Error('No se pudo subir el PDF al almacenamiento. Revisa tu conexión.');
  }

  return firma.ruta as string;
}
