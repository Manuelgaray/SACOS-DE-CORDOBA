// ─────────────────────────────────────────────────────────────────────────────
//  Mapeo de fila de PostgreSQL → tipo `Orden` de la app.
//  Se usa solo en el servidor (rutas API). No incluye los bytes del PDF: en su
//  lugar expone `pdf_url` apuntando al endpoint que sirve el archivo.
// ─────────────────────────────────────────────────────────────────────────────

import type { Orden, OrderStatus, Area } from '@/compartido/mock-data';
import { normalizarElementos } from '@/explosion-materiales/explosion';

export interface OrdenRow {
  id: string;
  numero_orden: string;
  cliente: string;
  spec: string;
  medida: string;
  cantidad: number;
  carga_lbs: number;
  tipo_saco: string;
  orden_cliente: string | null;
  embarcar_a: string | null;
  grado: string | null;
  area_actual: string | null;
  status: string;
  linea: number | null;
  fecha_creacion: Date | string;
  fecha_inicio: Date | string | null;
  fecha_entrega: string | null; // se selecciona como ::text → 'YYYY-MM-DD'
  has_pdf: boolean;
  corte_elementos: unknown; // JSONB → arreglo de ElementoCorte (o null)
  elaborado_por: string | null;
  autorizado_por: string | null;
  fecha_autorizacion: Date | string | null;
}

function toIso(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export function rowToOrden(r: OrdenRow): Orden {
  return {
    id: r.id,
    numero_orden: r.numero_orden,
    cliente: r.cliente,
    spec: r.spec,
    medida: r.medida,
    cantidad: Number(r.cantidad),
    carga_lbs: Number(r.carga_lbs),
    tipo_saco: r.tipo_saco,
    orden_cliente: r.orden_cliente,
    embarcar_a: r.embarcar_a,
    grado: r.grado,
    area_actual: r.area_actual as Area | null,
    status: r.status as OrderStatus,
    linea: r.linea as 1 | 2 | null,
    fecha_creacion: toIso(r.fecha_creacion) ?? '',
    fecha_inicio: toIso(r.fecha_inicio),
    fecha_entrega: r.fecha_entrega,
    pdf_url: r.has_pdf ? `/api/ordenes/${r.id}/pdf` : null,
    corte_elementos: r.corte_elementos == null ? null : normalizarElementos(r.corte_elementos),
    elaborado_por: r.elaborado_por ?? null,
    autorizado_por: r.autorizado_por ?? null,
    fecha_autorizacion: toIso(r.fecha_autorizacion),
  };
}

// Columnas comunes para SELECT/RETURNING (mismo shape que OrdenRow).
export const ORDEN_COLS = `
  id, numero_orden, cliente, spec, medida, cantidad, carga_lbs, tipo_saco,
  orden_cliente, embarcar_a, grado, area_actual, status, linea,
  fecha_creacion, fecha_inicio, fecha_entrega::text AS fecha_entrega,
  (pdf_data IS NOT NULL) AS has_pdf,
  corte_elementos, elaborado_por, autorizado_por, fecha_autorizacion
`;
