// ─────────────────────────────────────────────────────────────────────────────
//  Motor de producción — captura por área, líneas y progreso
// ─────────────────────────────────────────────────────────────────────────────

import { AREAS_FLOW, type Area, type Orden, type GrupoCorte } from '@/compartido/mock-data';

// La planta tiene 2 líneas de producción. Cada línea procesa órdenes de forma
// secuencial (pipeline). La línea de cada orden vive en `orden.linea`.

// ─── Modelo de captura ──────────────────────────────────────────────────────────

export interface ComponenteProduccion {
  nombre: string;
  meta: number;   // piezas objetivo
  hecho: number;  // piezas reportadas
}

export interface AvanceArea {
  area: Area;
  componentes: ComponenteProduccion[];
  // Último reporte registrado en la bitácora para esta orden/área (si existe):
  // cuándo y quién. Se muestra junto al avance para monitorear los tiempos.
  ultimoReporte?: { fecha: string; usuario: string | null };
}

// ─── Plantillas de componentes por área ──────────────────────────────────────────
// Define qué reporta cada supervisor. TODAS las áreas derivan sus puntos de
// reporte de LO QUE LA ORDEN LLEVA (los elementos capturados en la explosión de
// materiales y el tipo de saco): si la orden no lleva base, ningún área muestra
// puntos de base. `mult` se aplica sobre la cantidad de sacos; `metaFija` lo
// sustituye para reportes que no escalan por saco (ej. "material surtido" = 1).

export interface PlantillaItem { nombre: string; mult: number; grupo?: GrupoCorte; metaFija?: number }

// Lo mínimo de una orden que necesitan las plantillas (permite usarlas también
// desde la API de explosión, sin cargar la orden completa).
export type OrdenBase = Pick<Orden, 'tipo_saco' | 'cantidad' | 'corte_elementos'>;

// Marcas diacríticas combinantes (para comparar nombres sin acentos).
const DIACRITICOS_PROD = new RegExp('[\\u0300-\\u036f]', 'g');
function normNombre(s: string): string {
  return s.normalize('NFD').replace(DIACRITICOS_PROD, '').toLowerCase();
}

// Elementos base de la orden: los capturados en la explosión o, si aún no hay,
// la estructura estándar del tipo de saco.
function elementosBase(orden: OrdenBase): PlantillaItem[] {
  const deOrden = elementosCorteDeOrden(orden);
  return deOrden.length > 0 ? deOrden : plantillaCorte(orden.tipo_saco);
}


// ALMACÉN: surte la materia prima según los materiales de la orden — rollos de
// tela (uno por elemento de tela), discos de cinturones y bobinas de cintas y
// cordeles. Cada material se reporta como surtido (meta 1).
function plantillaAlmacen(base: PlantillaItem[]): PlantillaItem[] {
  const items: PlantillaItem[] = [];
  for (const el of base) {
    if ((el.grupo ?? 'tela') === 'tela') {
      items.push({ nombre: `Rollos de tela — ${el.nombre}`, mult: 0, metaFija: 1 });
    }
  }
  if (base.some((e) => e.grupo === 'cinturones')) {
    items.push({ nombre: 'Discos de cinturones surtidos', mult: 0, metaFija: 1 });
  }
  if (base.some((e) => e.grupo === 'cintas')) {
    items.push({ nombre: 'Bobinas de cintas y cordeles surtidas', mult: 0, metaFija: 1 });
  }
  return items;
}

// SMALL y TIPS comparten la HOJA DE CONTROL DE MATERIAL: su avance no se mide
// por piezas sino por las operaciones que el supervisor registra en la hoja —
// el 100 % es tener todos sus renglones marcados como terminados. La meta real
// (número de renglones) la fija la sincronización de la hoja.
export const PUNTO_HOJA_MATERIAL = 'Operaciones de la hoja de material';

function plantillaHojaMaterial(): PlantillaItem[] {
  return [{ nombre: PUNTO_HOJA_MATERIAL, mult: 0, metaFija: 1 }];
}

// BIG y TAPA comparten la HOJA DE RAW BAG Y TAPA: su avance también se mide por
// operaciones terminadas de esa hoja (la meta la fija el número de renglones).
export const PUNTO_HOJA_RAWBAG = 'Operaciones de la hoja de Raw Bag y Tapa';

function plantillaHojaRawbag(): PlantillaItem[] {
  return [{ nombre: PUNTO_HOJA_RAWBAG, mult: 0, metaFija: 1 }];
}

// CALIDAD: mesas de inspección (inflado, puntadas saltadas, hilos, hoyos). Se
// captura en el CONTROL DE MESAS DE CALIDAD: cada hoja lleva 4 mesas con su
// conteo de sacos revisados, y el avance es la suma de todas las mesas de todas
// las hojas contra los sacos de la orden.
export const PUNTO_HOJA_CALIDAD = 'Sacos revisados en mesas de calidad';

const PLANTILLA_CALIDAD: PlantillaItem[] = [
  { nombre: PUNTO_HOJA_CALIDAD, mult: 1 },
];

// EMPAQUE: prensado y armado de tarimas. Se captura en el CONTROL DE TARIMAS Y
// SACOS EN PRENSA: cada tarima lleva su conteo de sacos y su peso, y el avance
// es la suma de todas las tarimas contra los sacos de la orden.
export const PUNTO_HOJA_EMPAQUE = 'Sacos prensados en tarimas';

const PLANTILLA_EMPAQUE: PlantillaItem[] = [
  { nombre: PUNTO_HOJA_EMPAQUE, mult: 1 },
];

// Estructura "de cajón" por tipo de saco: lo obligatorio que siempre se corta.
// Los opcionales (tapa, base, faldón, válvulas, cordeles, cintas) se agregan por
// orden desde OPCIONALES_CORTE. El `grupo` define en qué cuenta entra cada uno
// (tela suma al total de tela; cinturones y cintas tienen su propia cuenta).
export function plantillaCorte(tipoSaco: string): PlantillaItem[] {
  const t = (tipoSaco || '').toUpperCase();

  if (t.includes('4-PANEL') || t.includes('Q-PANEL')) {
    return [
      { nombre: 'Laterales', mult: 4, grupo: 'tela' },
      { nombre: 'Base', mult: 1, grupo: 'tela' },
      { nombre: 'Cinturones', mult: 4, grupo: 'cinturones' },
    ];
  }
  if (t.includes('BAFFLE')) {
    return [
      { nombre: 'Laterales', mult: 4, grupo: 'tela' },
      { nombre: 'Baffles', mult: 4, grupo: 'tela' },
      { nombre: 'Base', mult: 1, grupo: 'tela' },
      { nombre: 'Cinturones', mult: 4, grupo: 'cinturones' },
    ];
  }
  if (t.includes('TUBULAR') || t.includes('CIRCULAR')) {
    return [
      { nombre: 'Tubular', mult: 1, grupo: 'tela' },
      { nombre: 'Base', mult: 1, grupo: 'tela' },
      { nombre: 'Tapa', mult: 1, grupo: 'tela' },
      { nombre: 'Cinturones', mult: 4, grupo: 'cinturones' },
    ];
  }
  // U-PANEL (default): de cajón 1 cuerpo + 2 laterales
  return [
    { nombre: 'Laterales', mult: 2, grupo: 'tela' },
    { nombre: 'Cuerpo', mult: 1, grupo: 'tela' },
    { nombre: 'Cinturones', mult: 4, grupo: 'cinturones' },
  ];
}

// Elementos opcionales que se agregan por orden (se ofrecen como "agregar" en la
// explosión de materiales). El multiplicador es un valor por defecto editable.
export const OPCIONALES_CORTE: PlantillaItem[] = [
   { nombre: 'Tubular', mult: 1, grupo: 'tela' },
  { nombre: 'Tapa', mult: 1, grupo: 'tela' },
  { nombre: 'Base', mult: 1, grupo: 'tela' },
  { nombre: 'Faldón', mult: 1, grupo: 'tela' },
  { nombre: 'Válvula de carga', mult: 1, grupo: 'tela' },
  { nombre: 'Válvula de descarga', mult: 1, grupo: 'tela' },
  // Plural en los que siempre van varios por saco; singular en cinta y cordel.
  // Los nombres deben coincidir con plantillaCorte() para no duplicar botones.
  { nombre: 'Baffles', mult: 4, grupo: 'tela' },
  { nombre: 'Cinturones', mult: 4, grupo: 'cinturones' },
  { nombre: 'Cinta', mult: 1, grupo: 'cintas' },
  { nombre: 'Cordel', mult: 1, grupo: 'cintas' },
];

// Elementos de corte reales de la orden (capturados en la explosión de
// materiales), listos para usarse como plantilla del área de corte.
export function elementosCorteDeOrden(orden: Pick<Orden, 'corte_elementos'>): PlantillaItem[] {
  return (orden.corte_elementos ?? [])
    .filter((e) => e.nombre.trim() !== '' && e.piezasPorSaco > 0)
    .map((e) => ({ nombre: e.nombre, mult: e.piezasPorSaco, grupo: e.grupo }));
}

// ─── Hoja oficial de cada área ──────────────────────────────────────────────────
// Varias áreas ya no capturan por componentes: su captura oficial es una HOJA
// (réplica de la del papel). Cuando se entra con la orden ya elegida hay que
// abrir esa hoja directamente, sin volver a pedir la orden. Esta es la única
// lista: el detalle de la orden y la lista del área la comparten.
export function rutaHojaDeArea(area: Area, ordenId: string): string | null {
  switch (area) {
    case 'corte':   return `/produccion/hoja-corte?orden=${ordenId}`;
    case 'small':
    case 'tips':    return `/produccion/hoja-material?orden=${ordenId}`;
    case 'big':
    case 'tapa':    return `/produccion/hoja-rawbag?orden=${ordenId}`;
    case 'calidad': return `/produccion/hoja-calidad?orden=${ordenId}`;
    case 'empaque': return `/produccion/hoja-empaque?orden=${ordenId}`;
    default:        return null;
  }
}

// Qué reporta cada área para ESTA orden (derivado de sus elementos).
function plantillaArea(area: Area, orden: OrdenBase): PlantillaItem[] {
  const base = elementosBase(orden);
  switch (area) {
    case 'almacen': return plantillaAlmacen(base);
    case 'corte':   return base;
    case 'small':   return plantillaHojaMaterial();
    case 'tips':    return plantillaHojaMaterial();
    case 'big':     return plantillaHojaRawbag();
    case 'tapa':    return plantillaHojaRawbag();
    case 'calidad': return PLANTILLA_CALIDAD;
    case 'empaque': return PLANTILLA_EMPAQUE;
  }
}

// Metas listas para persistir: nombre + meta calculada (para sembrar avances
// al crear la orden y para re-sincronizarlos al editar la explosión).
export function metasDeArea(orden: OrdenBase, area: Area): { nombre: string; meta: number }[] {
  return plantillaArea(area, orden).map((it) => ({
    nombre: it.nombre,
    meta: it.metaFija ?? orden.cantidad * it.mult,
  }));
}

// ─── Hoja de corte ↔ componentes de avance ─────────────────────────────────────
// La hoja física usa nombres universales (Lateral, Inlet, Outlet, Banda…); los
// componentes del avance vienen de la explosión (Laterales, Válvula de carga…).
// Este emparejador conecta ambos mundos para que los totales de la hoja
// alimenten solos el avance de Corte.
const ALIAS_HOJA: Record<string, string> = {
  inlet: 'valvula de carga',
  outlet: 'valvula de descarga',
  banda: 'cinturon',
};

export function coincideElementoHoja(nombreComponente: string, elementoHoja: string): boolean {
  const c = normNombre(nombreComponente);
  let e = normNombre(elementoHoja);
  e = ALIAS_HOJA[e] ?? e;
  if (!e || e === '2do corte') return false; // sin equivalente en el avance
  return c.includes(e) || e.includes(c);
}


// ─── Generación de avance inicial ─────────────────────────────────────────────────
// Siembra "hecho" según el estado y el área actual de la orden, para simular
// un pipeline realista (áreas previas completas, actual parcial, siguientes en 0).

function factorParcial(idx: number): number {
  // El primer componente del área va más avanzado que los siguientes
  // (ej. cuerpos 100%, laterales 70%) — como en bitácora real.
  const f = 0.85 - idx * 0.18;
  return Math.max(0.2, Math.min(0.95, f));
}

export function generarAvance(orden: Orden): AvanceArea[] {
  const idxActual = orden.area_actual ? AREAS_FLOW.indexOf(orden.area_actual) : -1;

  return AREAS_FLOW.map((area) => {
    const idxArea = AREAS_FLOW.indexOf(area);
    const items = plantillaArea(area, orden);

    const componentes: ComponenteProduccion[] = items.map((it, i) => {
      const meta = it.metaFija ?? orden.cantidad * it.mult;
      let hecho = 0;

      if (orden.status === 'terminada') {
        hecho = meta;
      } else if (orden.status === 'programada' || idxActual === -1) {
        hecho = 0;
      } else if (idxArea < idxActual) {
        hecho = meta;                              // área ya completada
      } else if (idxArea === idxActual) {
        hecho = Math.round(meta * factorParcial(i)); // área en curso
      } else {
        hecho = 0;                                 // área futura
      }

      return { nombre: it.nombre, meta, hecho };
    });

    return { area, componentes };
  }).filter((av) => av.componentes.length > 0);
  // ↑ un área sin puntos para esta orden (ej. Small en tubulares) no aparece.
}

// ─── Helpers de progreso ────────────────────────────────────────────────────────

export function progresoComponente(c: ComponenteProduccion): number {
  if (c.meta <= 0) return 0;
  return Math.min(100, Math.round((c.hecho / c.meta) * 100));
}

export function progresoArea(av: AvanceArea): number {
  const meta = av.componentes.reduce((s, c) => s + c.meta, 0);
  const hecho = av.componentes.reduce((s, c) => s + Math.min(c.hecho, c.meta), 0);
  if (meta <= 0) return 0;
  return Math.round((hecho / meta) * 100);
}

// Progreso global de la orden = promedio del avance de cada área (como pidió el cliente)
export function progresoOrden(avances: AvanceArea[]): number {
  if (avances.length === 0) return 0;
  const suma = avances.reduce((s, av) => s + progresoArea(av), 0);
  return Math.round(suma / avances.length);
}

// Devuelve la primera área no terminada (el "frente" de trabajo de la orden)
export function areaEnCurso(avances: AvanceArea[]): Area | null {
  for (const av of avances) {
    if (progresoArea(av) < 100) return av.area;
  }
  return null;
}

