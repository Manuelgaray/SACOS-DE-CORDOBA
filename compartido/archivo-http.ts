// ─────────────────────────────────────────────────────────────────────────────
//  Cabeceras para servir archivos (solo servidor).
//
//  Las cabeceras HTTP son ByteString: solo admiten caracteres de 0 a 255. Un
//  nombre con acentos ("diseño.pdf") o un spec con una letra de otro alfabeto
//  (BI-QEM130А lleva una А cirílica) reventaban el `new Response(...)`.
//  Aquí se sanea todo lo que va a una cabecera.
// ─────────────────────────────────────────────────────────────────────────────

/** Solo ASCII imprimible: lo que no lo sea se sustituye. */
function soloAscii(texto: string, relleno = '_'): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[^\x20-\x7E]/g, relleno).replace(/["\\]/g, '');
}

/**
 * Content-Disposition con el nombre real. Se manda dos veces: `filename` en
 * ASCII para navegadores viejos y `filename*` codificado en UTF-8 (RFC 5987)
 * para que el nombre con acentos llegue completo.
 */
export function contentDisposition(nombre: string): string {
  const seguro = soloAscii(nombre) || 'archivo.pdf';
  return `inline; filename="${seguro}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

/**
 * ETag válido: se construye SOLO con valores numéricos (tamaño y marca de
 * tiempo), nunca con texto que venga de la base. Es único por URL, que es lo
 * único que importa para la revalidación.
 */
export function etagDe(prefijo: string, ...partes: (number | string)[]): string {
  return `"${soloAscii(prefijo, '-')}-${partes.map(p => soloAscii(String(p), '-')).join('-')}"`;
}

/** Cabeceras completas para servir un PDF privado y revalidable. */
export function cabecerasPdf(mime: string | null, nombre: string, etag: string): HeadersInit {
  return {
    'Content-Type': mime || 'application/pdf',
    'Content-Disposition': contentDisposition(nombre),
    // Privada y siempre revalidada: se comprueba con el ETag (petición mínima)
    // en vez de volver a bajar el archivo completo.
    'Cache-Control': 'private, max-age=0, must-revalidate',
    ETag: etag,
  };
}
