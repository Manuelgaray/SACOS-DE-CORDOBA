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
  // Cuándo terminó la orden (status → terminada); alimenta el calendario.
  fecha_fin: string | null;
  // El diseño y las especificaciones técnicas viven en el PDF subido (data URL).
  pdf_url: string | null;
  // Elementos de corte capturados/extraídos para la explosión de materiales.
  corte_elementos: ElementoCorte[] | null;
  // Firmas reales: quién creó la orden y qué admin la autorizó (null = pendiente).
  elaborado_por: string | null;
  autorizado_por: string | null;
  fecha_autorizacion: string | null;
}

// ─── Helpers de área ──────────────────────────────────────────────────────────

export const AREA_LABELS: Record<Area, string> = {
  almacen: 'Almacén',
  corte:   'Corte',
  small:   'Small',
  big:     'Big',
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

// Secuencia real del flujo de producción de la planta. Define el orden en que se
// muestran las áreas (menú, detalle de la orden, calendario) y cuál es el
// "frente de trabajo" de una orden (la primera área que no está al 100 %).
export const AREAS_FLOW: Area[] = ['almacen', 'corte', 'small', 'tips', 'big', 'tapa', 'calidad', 'empaque'];

// Las órdenes ya no viven aquí: se guardan en PostgreSQL (tabla `ordenes`) y se
// cargan vía /api/data. Las órdenes de ejemplo se siembran en db/schema.sql.

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Las fechas sin hora ('YYYY-MM-DD', como la FMF) se anclan al mediodía local:
 *  new Date('2026-07-15') es medianoche UTC y en México mostraría el día 14. */
function aFechaLocal(dateStr: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())
    ? new Date(`${dateStr.trim()}T12:00:00`)
    : new Date(dateStr);
}

export function formatDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—';
  return aFechaLocal(dateStr).toLocaleDateString('es-MX', opts ?? {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return aFechaLocal(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

/** Fecha corta + hora (para marcas de reportes: "22 jul 10:15 a.m."). */
export function formatFechaHora(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  );
}
