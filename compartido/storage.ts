// ─────────────────────────────────────────────────────────────────────────────
//  ALMACENAMIENTO DE PDFs — Supabase Storage (solo servidor).
//
//  Los planos ya NO viven dentro de PostgreSQL: van a un bucket PRIVADO y la
//  base guarda solo la ruta. Dos razones:
//
//   1. Vercel limita a 4.5 MB el cuerpo de sus funciones. Un plano de 8 MB no
//      pasaría ni al subir ni al abrir. Con URLs firmadas el archivo viaja
//      DIRECTO entre el navegador y Supabase, sin pasar por nuestro servidor.
//   2. Los respaldos de la base dejan de arrastrar gigabytes de PDFs.
//
//  El bucket es privado: nadie llega al archivo sin una URL firmada, y esas
//  las emite el servidor solo después de comprobar la sesión.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'disenos';

// Minutos de vida de las URLs firmadas. Cortas: solo tienen que durar lo que
// tarda el navegador en abrir o subir el archivo.
const MIN_DESCARGA = 10;
const MIN_SUBIDA = 15;

function cliente() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secreta = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secreta) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. ' +
        'La llave secreta es de servidor: nunca debe exponerse al navegador.',
    );
  }
  // La llave secreta se salta las reglas de la base: por eso este módulo solo
  // puede importarse desde rutas de API (runtime nodejs).
  return createClient(url, secreta, { auth: { persistSession: false } });
}

/** Ruta del plano de una orden dentro del bucket. */
export const rutaOrden = (ordenId: string) => `ordenes/${ordenId}.pdf`;

/** Ruta del plano de un diseño (spec) dentro del bucket. */
export const rutaSpec = (spec: string) =>
  `specs/${encodeURIComponent(spec.trim().toUpperCase())}.pdf`;

/**
 * Ruta temporal. Al crear una orden el id lo genera el servidor, así que el
 * navegador sube primero aquí y el servidor mueve el archivo a su lugar
 * definitivo cuando la orden ya existe.
 */
export const rutaTemporal = () => `temp/${crypto.randomUUID()}.pdf`;

/** Mueve un objeto (copiar + borrar el origen). */
export async function moverObjeto(desde: string, hacia: string): Promise<boolean> {
  const { error } = await cliente().storage.from(BUCKET).move(desde, hacia);
  return !error;
}

/**
 * URL temporal para que el NAVEGADOR suba el archivo directo a Supabase.
 * Así el PDF nunca pasa por nuestro servidor y no le aplica el límite de Vercel.
 */
export async function urlDeSubida(ruta: string) {
  const { data, error } = await cliente()
    .storage.from(BUCKET)
    .createSignedUploadUrl(ruta, { upsert: true });
  if (error) throw new Error(`No se pudo preparar la subida: ${error.message}`);
  return { url: data.signedUrl, token: data.token, ruta };
}

/** URL temporal de lectura. El bucket es privado: sin firma no se llega. */
export async function urlDeDescarga(ruta: string): Promise<string | null> {
  const { data, error } = await cliente()
    .storage.from(BUCKET)
    .createSignedUrl(ruta, MIN_DESCARGA * 60);
  if (error) return null;
  return data.signedUrl;
}

/** Copia un objeto dentro del bucket (heredar el plano de un spec a una orden). */
export async function copiarObjeto(desde: string, hacia: string): Promise<boolean> {
  const { error } = await cliente().storage.from(BUCKET).copy(desde, hacia);
  return !error;
}

/** Borra un objeto. Se usa al eliminar un diseño o una orden. */
export async function borrarObjeto(ruta: string): Promise<void> {
  await cliente().storage.from(BUCKET).remove([ruta]);
}

/** ¿Existe el objeto? (para saber si un spec ya tiene plano). */
export async function existeObjeto(ruta: string): Promise<boolean> {
  const barra = ruta.lastIndexOf('/');
  const carpeta = barra >= 0 ? ruta.slice(0, barra) : '';
  const nombre = barra >= 0 ? ruta.slice(barra + 1) : ruta;
  const { data, error } = await cliente().storage.from(BUCKET).list(carpeta, { search: nombre });
  return !error && !!data?.some(o => o.name === nombre);
}

export const MIN_SUBIDA_URL = MIN_SUBIDA;
