// ─── Tipos ────────────────────────────────────────────────────────────────────

export type OrderStatus = 'activa' | 'programada' | 'pausada' | 'terminada' | 'cancelada';

export type Area = 'almacen' | 'corte' | 'small' | 'big' | 'tips' | 'tapa' | 'calidad' | 'empaque';

// ─── Explosión de materiales (corte) ──────────────────────────────────────────
// Un elemento a cortar de la orden (la lógica de cálculo vive en ./explosion).
export type UnidadMedida = 'in' | 'cm';

// Grupo de material: la tela se suma en el total de tela; cinturones y cintas
// (que no son tela) van en sus propios grupos con su propia cuenta.
export type GrupoCorte = 'tela' | 'cinturones' | 'cintas';

export interface ElementoCorte {
  nombre: string;
  piezasPorSaco: number;
  ancho: number;
  largo: number;
  unidad: UnidadMedida;
  grupo: GrupoCorte;
}

export interface Orden {
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
  area_actual: Area | null;
  status: OrderStatus;
  linea: 1 | 2 | null;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  // El diseño y las especificaciones técnicas viven en el PDF subido (data URL).
  pdf_url: string | null;
  // Elementos de corte capturados/extraídos para la explosión de materiales.
  corte_elementos: ElementoCorte[] | null;
}

// ─── Helpers de área ──────────────────────────────────────────────────────────

export const AREA_LABELS: Record<Area, string> = {
  almacen: 'Almacén',
  corte:   'Corte',
  small:   'Sacos Small',
  big:     'Sacos Big',
  tips:    'Tips',
  tapa:    'Tapa',
  calidad: 'Calidad',
  empaque: 'Empaque',
};

export const AREA_COLORS: Record<Area, { bg: string; text: string; border: string }> = {
  almacen: { bg: 'bg-almacen-bg', text: 'text-almacen-text', border: 'border-[#C8C2A8]' },
  corte:   { bg: 'bg-corte-bg',   text: 'text-corte-text',   border: 'border-[#E8C88A]' },
  small:   { bg: 'bg-small-bg',   text: 'text-small-text',   border: 'border-[#A8C8E8]' },
  big:     { bg: 'bg-big-bg',     text: 'text-big-text',     border: 'border-[#88C8A8]' },
  tips:    { bg: 'bg-tips-bg',    text: 'text-tips-text',    border: 'border-[#B0AAEE]' },
  tapa:    { bg: 'bg-tapa-bg',    text: 'text-tapa-text',    border: 'border-[#E0A8C0]' },
  calidad: { bg: 'bg-calidad-bg', text: 'text-calidad-text', border: 'border-[#E8A0A0]' },
  empaque: { bg: 'bg-empaque-bg', text: 'text-empaque-text', border: 'border-[#A8C888]' },
};

export const AREAS_FLOW: Area[] = ['almacen', 'corte', 'small', 'big', 'tips', 'tapa', 'calidad', 'empaque'];

// Las órdenes ya no viven aquí: se guardan en PostgreSQL (tabla `ordenes`) y se
// cargan vía /api/data. Las órdenes de ejemplo se siembran en db/schema.sql.

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', opts ?? {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}
