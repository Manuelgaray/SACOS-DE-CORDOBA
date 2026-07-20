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
}

// ─── Plantillas de componentes por área ──────────────────────────────────────────
// Define qué reporta cada supervisor. El multiplicador se aplica sobre la
// cantidad de sacos de la orden (ej. cinturones ×4 por saco).

export interface PlantillaItem { nombre: string; mult: number; grupo?: GrupoCorte }

const PLANTILLA_AREAS: Record<Exclude<Area, 'corte'>, PlantillaItem[]> = {
  almacen: [
    { nombre: 'Tela de cuerpo surtida', mult: 1 },
    { nombre: 'Tela de válvulas surtida', mult: 1 },
    { nombre: 'Hilo y cinta surtidos', mult: 1 },
  ],
  small: [
    { nombre: 'Dobladillo en laterales', mult: 1 },
    { nombre: 'Dobladillo en cuerpo', mult: 1 },
    { nombre: 'Costura de cinturones', mult: 4 },
  ],
  big: [
    { nombre: 'Ensamble de cuerpo', mult: 1 },
    { nombre: 'Costura de bandas de carga', mult: 4 },
  ],
  tips: [
    { nombre: 'Armado válvula de carga', mult: 1 },
    { nombre: 'Armado válvula de descarga', mult: 1 },
  ],
  tapa: [
    { nombre: 'Ensamble de tapa a raw bag', mult: 1 },
    { nombre: 'Cierre final del saco', mult: 1 },
  ],
  calidad: [
    { nombre: 'Inspección de calidad', mult: 1 },
  ],
  empaque: [
    { nombre: 'Inflado + detector de metales', mult: 1 },
    { nombre: 'Empacado en pacas', mult: 1 },
  ],
};

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
      { nombre: 'Cuerpo tubular', mult: 1, grupo: 'tela' },
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
  { nombre: 'Tapa', mult: 1, grupo: 'tela' },
  { nombre: 'Base', mult: 1, grupo: 'tela' },
  { nombre: 'Faldón', mult: 1, grupo: 'tela' },
  { nombre: 'Válvula de carga', mult: 1, grupo: 'tela' },
  { nombre: 'Válvula de descarga', mult: 1, grupo: 'tela' },
  { nombre: 'Baffle', mult: 4, grupo: 'tela' },
  { nombre: 'Cinturon', mult: 4, grupo: 'cinturones' },
  { nombre: 'Cinta', mult: 1, grupo: 'cintas' },
  { nombre: 'Cordel', mult: 1, grupo: 'cintas' },
];

// Elementos de corte reales de la orden (capturados en la explosión de
// materiales), listos para usarse como plantilla del área de corte.
export function elementosCorteDeOrden(orden: Orden): PlantillaItem[] {
  return (orden.corte_elementos ?? [])
    .filter((e) => e.nombre.trim() !== '' && e.piezasPorSaco > 0)
    .map((e) => ({ nombre: e.nombre, mult: e.piezasPorSaco, grupo: e.grupo }));
}

function plantillaArea(area: Area, orden: Orden): PlantillaItem[] {
  if (area === 'corte') {
    // El área de corte refleja LO QUE LA ORDEN LLEVA: los elementos capturados
    // en la explosión (laterales, base, válvulas, cintas…). Si la orden no
    // tiene explosión, cae a la estructura estándar del tipo de saco.
    const deOrden = elementosCorteDeOrden(orden);
    return deOrden.length > 0 ? deOrden : plantillaCorte(orden.tipo_saco);
  }
  return PLANTILLA_AREAS[area];
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
      const meta = orden.cantidad * it.mult;
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
  });
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

