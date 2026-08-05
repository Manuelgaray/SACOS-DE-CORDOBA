// ─────────────────────────────────────────────────────────────────────────────
//  Extracción de elementos de corte desde un PDF  (SOLO SERVIDOR, runtime nodejs)
//
//  Pasos:
//   1. Capa de texto con pdfjs (PDFs vectoriales de CAD).
//   2. OCR de respaldo con tesseract.js + @napi-rs/canvas (PDFs escaneados).
//   3. Semilla = plantilla del tipo de saco + elementos detectados por palabra
//      clave en el texto (faldón, válvulas, cintas, cordeles, baffles, etc.).
//   4. Relleno de ancho/largo buscando medidas "A x B" cercanas a cada nombre.
//
//  Es BEST-EFFORT: en planos CAD el texto está disperso, así que el resultado es
//  parcial. Por eso la tabla siempre es editable y se muestra el texto leído.
// ─────────────────────────────────────────────────────────────────────────────

import { elementosDesdePlantilla } from '@/explosion-materiales/explosion';
import { parseMedidas, normalizarTexto } from '@/explosion-materiales/corte-parse';
import type { ElementoCorte, GrupoCorte } from '@/compartido/mock-data';

export interface ResultadoExtraccion {
  elementos: ElementoCorte[];
  metodo: 'texto' | 'ocr' | 'ninguno';
  textoCrudo: string;
}

// ─── Paso 1: capa de texto ──────────────────────────────────────────────────────
async function extraerTextoPdf(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let texto = '';
  const maxPaginas = Math.min(doc.numPages, 8);
  for (let p = 1; p <= maxPaginas; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string }>;
    texto += items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ') + '\n';
  }
  await doc.destroy();
  return texto;
}

// ─── Paso 2: OCR de respaldo ────────────────────────────────────────────────────
async function ocrPdf(buf: Buffer): Promise<string> {
  const canvasMod = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= (canvasMod as unknown as { DOMMatrix: unknown }).DOMMatrix;
  g.Path2D ??= (canvasMod as unknown as { Path2D: unknown }).Path2D;
  g.ImageData ??= (canvasMod as unknown as { ImageData: unknown }).ImageData;

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const { createWorker } = await import('tesseract.js');
  // Tesseract descarga los idiomas y los guarda en disco. En serverless el
  // único directorio con escritura es el temporal del sistema; sin esto el OCR
  // falla en Vercel con un error de permisos difícil de rastrear.
  const { tmpdir } = await import('node:os');
  const worker = await createWorker(['spa', 'eng'], undefined, { cachePath: tmpdir() });

  let texto = '';
  const maxPaginas = Math.min(doc.numPages, 2);
  try {
    for (let p = 1; p <= maxPaginas; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const png = canvas.toBuffer('image/png');
      const { data } = await worker.recognize(png);
      texto += data.text + '\n';
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
  return texto;
}

// ─── Paso 3: detección de elementos por palabra clave ───────────────────────────
function mk(nombre: string, mult: number, grupo: GrupoCorte): ElementoCorte {
  return { nombre, piezasPorSaco: mult, ancho: 0, largo: 0, unidad: 'in', grupo };
}

// Catálogo de elementos que se pueden detectar en el texto del PDF. Las claves
// están normalizadas (sin acentos, minúsculas) y se buscan como subcadena. El
// orden importa: las frases más específicas (válvula de carga) van primero.
const DETECTABLES: { claves: string[]; el: ElementoCorte }[] = [
  { claves: ['faldon'],                          el: mk('Faldón', 1, 'tela') },
  { claves: ['valvula de descarga', 'descarga'], el: mk('Válvula de descarga', 1, 'tela') },
  { claves: ['valvula de carga', 'valvula'],     el: mk('Válvula de carga', 1, 'tela') },
  { claves: ['baffle', 'deflector'],             el: mk('Baffles', 4, 'tela') },
  { claves: ['cordel', 'amarre', 'lazo'],        el: mk('Cordel', 1, 'cintas') },
  { claves: ['cinta'],                           el: mk('Cinta', 1, 'cintas') },
  { claves: ['cinturon', 'banda de carga', 'loop'], el: mk('Cinturones', 4, 'cinturones') },
  { claves: ['faja'],                            el: mk('Cinturones', 4, 'cinturones') },
  { claves: ['tapa', 'top'],                     el: mk('Tapa', 1, 'tela') },
  { claves: ['fondo', 'base inferior'],          el: mk('Base', 1, 'tela') },
  { claves: ['lateral'],                         el: mk('Laterales', 2, 'tela') },
  { claves: ['cuerpo', 'body'],                  el: mk('Cuerpo', 1, 'tela') },
];

// Detecta en el texto elementos que NO estén ya en la semilla y los agrega.
function detectarExtra(texto: string, base: ElementoCorte[]): ElementoCorte[] {
  const t = normalizarTexto(texto);
  const yaHay = new Set(base.map((b) => normalizarTexto(b.nombre)));
  const extra: ElementoCorte[] = [];

  for (const d of DETECTABLES) {
    const nombreNorm = normalizarTexto(d.el.nombre);
    if (yaHay.has(nombreNorm)) continue;          // ya está en la semilla
    if (extra.some((e) => normalizarTexto(e.nombre) === nombreNorm)) continue; // ya detectado
    const presente = d.claves.some((k) => t.includes(k));
    if (presente) extra.push({ ...d.el });
  }
  return extra;
}

// Combina semilla (plantilla del tipo de saco) + detectados, y rellena medidas.
export function construirElementos(tipoSaco: string, texto: string): ElementoCorte[] {
  const base = elementosDesdePlantilla(tipoSaco);
  const combinados = texto ? [...base, ...detectarExtra(texto, base)] : base;
  return texto ? parseMedidas(texto, combinados) : combinados;
}

// ─── Orquestador ────────────────────────────────────────────────────────────────
export async function extraerElementosDePdf(
  buf: Buffer,
  tipoSaco: string,
): Promise<ResultadoExtraccion> {
  let texto = '';
  let metodo: 'texto' | 'ocr' | 'ninguno' = 'ninguno';

  try {
    texto = await extraerTextoPdf(buf);
    if (texto.replace(/\s/g, '').length >= 40) metodo = 'texto';
  } catch (e) {
    console.error('Error extrayendo la capa de texto del PDF:', e);
  }

  if (metodo === 'ninguno') {
    try {
      const ocr = await ocrPdf(buf);
      if (ocr.trim().length > 0) {
        texto = ocr;
        metodo = 'ocr';
      }
    } catch (e) {
      console.error('OCR falló (se continúa sin medidas):', e);
    }
  }

  return {
    elementos: construirElementos(tipoSaco, texto),
    metodo,
    textoCrudo: texto.slice(0, 4000),
  };
}

// Decodifica un PDF que viene como data URL ("data:application/pdf;base64,...")
// o como base64 puro, a Buffer.
export function pdfDesdeBase64(campo: string): Buffer {
  const coma = campo.indexOf(',');
  const b64 = coma >= 0 ? campo.slice(coma + 1) : campo;
  return Buffer.from(b64, 'base64');
}
