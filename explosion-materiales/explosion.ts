// ─────────────────────────────────────────────────────────────────────────────
//  Explosión de materiales (área de corte)
//
//  A partir de los elementos a cortar (nombre, piezas por saco, ancho, largo,
//  grupo) y la cantidad de sacos de la orden, calcula la materia prima necesaria:
//  total de piezas y longitud lineal equivalente en pulgadas, cm, metros y yardas.
//
//  Los elementos se agrupan: la TELA suma su propio total; CINTURONES y CINTAS
//  (que no son tela) llevan su cuenta aparte. Cada grupo tiene su subtotal.
//
//  Modelo: se asume que el rollo cubre el ancho de la pieza, por lo que cada
//  pieza consume su "largo" → longitud lineal = piezas × largo. (El aprovecha-
//  miento por ancho de rollo / nesting queda como mejora futura.)
// ─────────────────────────────────────────────────────────────────────────────

import { plantillaCorte, OPCIONALES_CORTE, type PlantillaItem } from '@/produccion/produccion';
import type { ElementoCorte, UnidadMedida, GrupoCorte } from '@/compartido/mock-data';

// Re-exportamos los tipos base para importarlos desde aquí o desde ./mock-data.
export type { ElementoCorte, UnidadMedida, GrupoCorte };

export const GRUPO_LABEL: Record<GrupoCorte, string> = {
  tela: 'Tela',
  cinturones: 'Cinturones',
  cintas: 'Cintas',
};

// Orden de presentación de los grupos.
const ORDEN_GRUPOS: GrupoCorte[] = ['tela', 'cinturones', 'cintas'];

export interface Longitudes {
  in: number;
  cm: number;
  m: number;
  yd: number;
}

export interface ResultadoElemento {
  nombre: string;
  grupo: GrupoCorte;
  piezasPorSaco: number;
  piezasTotales: number;
  anchoIn: number;        // dimensiones normalizadas a pulgadas (para mostrar)
  largoIn: number;
  longitudLineal: Longitudes;
}

export interface GrupoResultado {
  grupo: GrupoCorte;
  etiqueta: string;
  elementos: ResultadoElemento[];
  totalPiezas: number;
  totalLineal: Longitudes;
}

export interface ResultadoExplosion {
  cantidadSacos: number;
  grupos: GrupoResultado[];
  totalTela: Longitudes;  // conveniencia: total del grupo "tela"
}

const CM_POR_IN = 2.54;
const IN_POR_YD = 36;
const CERO: Longitudes = { in: 0, cm: 0, m: 0, yd: 0 };

function aPulgadas(valor: number, unidad: UnidadMedida): number {
  return unidad === 'cm' ? valor / CM_POR_IN : valor;
}

function longitudesDesdeIn(totalIn: number): Longitudes {
  const cm = totalIn * CM_POR_IN;
  return { in: totalIn, cm, m: cm / 100, yd: totalIn / IN_POR_YD };
}

function sumarLongitudes(a: Longitudes, b: Longitudes): Longitudes {
  return { in: a.in + b.in, cm: a.cm + b.cm, m: a.m + b.m, yd: a.yd + b.yd };
}

export function calcularExplosion(
  elementos: ElementoCorte[],
  cantidadSacos: number,
): ResultadoExplosion {
  const sacos = Math.max(0, Math.floor(cantidadSacos || 0));

  const calc: ResultadoElemento[] = elementos.map((el) => {
    const grupo: GrupoCorte = el.grupo ?? 'tela';
    const piezasTotales = Math.max(0, el.piezasPorSaco || 0) * sacos;
    const anchoIn = aPulgadas(el.ancho || 0, el.unidad);
    const largoIn = aPulgadas(el.largo || 0, el.unidad);
    const longitudLineal = longitudesDesdeIn(piezasTotales * largoIn);
    return {
      nombre: el.nombre,
      grupo,
      piezasPorSaco: el.piezasPorSaco,
      piezasTotales,
      anchoIn,
      largoIn,
      longitudLineal,
    };
  });

  const grupos: GrupoResultado[] = [];
  for (const g of ORDEN_GRUPOS) {
    const els = calc.filter((e) => e.grupo === g);
    if (els.length === 0) continue;
    const totalLineal = els.reduce((acc, r) => sumarLongitudes(acc, r.longitudLineal), { ...CERO });
    const totalPiezas = els.reduce((acc, r) => acc + r.piezasTotales, 0);
    grupos.push({ grupo: g, etiqueta: GRUPO_LABEL[g], elementos: els, totalPiezas, totalLineal });
  }

  const totalTela = grupos.find((g) => g.grupo === 'tela')?.totalLineal ?? { ...CERO };

  return { cantidadSacos: sacos, grupos, totalTela };
}

// Siembra los elementos "de cajón" del tipo de saco. La lista y las piezas/saco
// vienen de la plantilla (confiables); ancho/largo se llenan después (extracción
// del PDF o captura manual).
export function elementosDesdePlantilla(tipoSaco: string): ElementoCorte[] {
  return plantillaCorte(tipoSaco).map((it) => ({
    nombre: it.nombre,
    piezasPorSaco: it.mult,
    ancho: 0,
    largo: 0,
    unidad: 'in' as UnidadMedida,
    grupo: it.grupo ?? 'tela',
  }));
}

// Opciones para el botón "Agregar": los elementos de la plantilla del tipo de
// saco (Laterales, Cuerpo, Base…) + los opcionales universales (faldón,
// válvulas, cintas, cordeles…), sin repetir. Así, si se elimina por error un
// elemento de cajón, se puede volver a agregar con un clic.
export function opcionesCorte(tipoSaco?: string): ElementoCorte[] {
  const items: PlantillaItem[] = tipoSaco ? [...plantillaCorte(tipoSaco)] : [];
  for (const op of OPCIONALES_CORTE) {
    if (!items.some((i) => i.nombre.toLowerCase() === op.nombre.toLowerCase())) {
      items.push(op);
    }
  }
  return items.map((it) => ({
    nombre: it.nombre,
    piezasPorSaco: it.mult,
    ancho: 0,
    largo: 0,
    unidad: 'in' as UnidadMedida,
    grupo: it.grupo ?? 'tela',
  }));
}

// Normaliza datos que vienen del cliente o de la base de datos a ElementoCorte[].
export function normalizarElementos(raw: unknown): ElementoCorte[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): ElementoCorte | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : '';
      if (!nombre) return null;
      const unidad: UnidadMedida = o.unidad === 'cm' ? 'cm' : 'in';
      const grupo: GrupoCorte =
        o.grupo === 'cinturones' || o.grupo === 'cintas' ? o.grupo : 'tela';
      return {
        nombre,
        piezasPorSaco: Number(o.piezasPorSaco) || 0,
        ancho: Number(o.ancho) || 0,
        largo: Number(o.largo) || 0,
        unidad,
        grupo,
      };
    })
    .filter((x): x is ElementoCorte => x !== null);
}

// Formatea un número para mostrar (separador de miles, decimales razonables).
export function fmt(n: number, decimales = 2): string {
  return n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  });
}
