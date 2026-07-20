// ─────────────────────────────────────────────────────────────────────────────
//  Parseo heurístico de medidas de corte
//
//  A partir del texto extraído de un PDF y la lista de elementos sembrada desde
//  la plantilla del tipo de saco, intenta llenar `ancho`/`largo` buscando
//  patrones de medida "A x B" cercanos al nombre de cada elemento.
//
//  Es BEST-EFFORT: en planos de AutoCAD el texto está disperso entre líneas y
//  figuras, así que el resultado puede ser parcial o impreciso. Por eso siempre
//  se muestra en una tabla editable para que el usuario revise/corrija.
// ─────────────────────────────────────────────────────────────────────────────

import type { ElementoCorte } from '@/compartido/mock-data';

const MAX_DIST = 240; // distancia máx. (caracteres) entre el nombre y la medida

// Marcas diacríticas combinantes (U+0300–U+036F). Se construye con códigos para
// no incrustar caracteres combinantes en el código fuente.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(DIACRITICOS, '');
}

// Normaliza texto para comparar: sin acentos, en minúsculas. Exportada para que
// la detección de elementos use exactamente el mismo criterio que el parseo.
export function normalizarTexto(s: string): string {
  return sinAcentos(s).toLowerCase();
}

function norm(s: string): string {
  return normalizarTexto(s);
}

interface ParMedida { a: number; b: number; idx: number }

// Encuentra pares "A x B" (con o sin comillas/unidades) y su posición en el texto.
export function encontrarPares(texto: string): ParMedida[] {
  const re = /(\d+(?:\.\d+)?)\s*(?:"|''|in|pulg\.?|pulgadas|cm)?\s*[x×]\s*(\d+(?:\.\d+)?)/gi;
  const out: ParMedida[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    out.push({ a: parseFloat(m[1]), b: parseFloat(m[2]), idx: m.index });
  }
  return out;
}

// Palabra clave principal para localizar un elemento dentro del texto.
function clave(nombre: string): string {
  const limpio = norm(nombre).replace(/\(.*?\)/g, '').trim();
  return limpio.split(/\s+/)[0] ?? '';
}

// Devuelve una copia de `elementos` con ancho/largo rellenados donde se pudo.
export function parseMedidas(texto: string, elementos: ElementoCorte[]): ElementoCorte[] {
  const t = norm(texto);
  const pares = encontrarPares(t);
  if (pares.length === 0) return elementos;

  return elementos.map((el) => {
    const k = clave(el.nombre);
    if (!k) return el;
    const pos = t.indexOf(k);
    if (pos < 0) return el;

    let mejor: ParMedida | null = null;
    let mejorDist = Infinity;
    for (const p of pares) {
      const d = Math.abs(p.idx - pos);
      if (d < mejorDist) { mejorDist = d; mejor = p; }
    }
    if (!mejor || mejorDist > MAX_DIST) return el;
    return { ...el, ancho: mejor.a, largo: mejor.b };
  });
}
