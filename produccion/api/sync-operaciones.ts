// ─────────────────────────────────────────────────────────────────────────────
//  Avance POR OPERACIONES (solo servidor).
//
//  Varias áreas capturan en hojas cuyo avance no se mide por piezas sino por las
//  operaciones que registra el supervisor: el 100 % es tener todos los renglones
//  de la hoja marcados como terminados. La meta la fija el propio supervisor con
//  el número de renglones que pone.
//
//    hoja_material  → Small y Tips
//    hoja_rawbag    → Big y Tapa
//
//  Calidad es la excepción: su hoja SÍ cuenta piezas (sacos revisados en las
//  mesas), así que su avance se mide contra los sacos de la orden.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';
import {
  PUNTO_HOJA_MATERIAL, PUNTO_HOJA_RAWBAG, PUNTO_HOJA_CALIDAD,
  PUNTO_HOJA_EMPAQUE, PUNTO_HOJA_ALMACEN,
} from '@/produccion/produccion';
import type { Area } from '@/compartido/mock-data';

const VENTANA_FUSION_MIN = 10;

export const AREAS_HOJA_MATERIAL: Area[] = ['small', 'tips'];
export const AREAS_HOJA_RAWBAG: Area[] = ['big', 'tapa'];
export const AREAS_HOJA_CALIDAD: Area[] = ['calidad'];
export const AREAS_HOJA_EMPAQUE: Area[] = ['empaque'];
export const AREAS_HOJA_ALMACEN: Area[] = ['almacen'];

// Tablas permitidas (el nombre no puede ir como parámetro en SQL).
const TABLA = {
  material: 'hoja_material',
  rawbag: 'hoja_rawbag',
  calidad: 'hoja_calidad',
  empaque: 'hoja_empaque',
  almacen: 'hoja_almacen',
} as const;

export interface UsuarioSync {
  email: string;
  nombre: string;
}

export interface AvanceAreaSync {
  area: Area;
  componentes: { nombre: string; meta: number; hecho: number }[];
}

/**
 * Escribe el avance (meta/hecho) en las áreas indicadas y lo registra en la
 * bitácora. `meta` y `hecho` ya vienen calculados por cada tipo de hoja.
 */
async function aplicarAAreas(
  ordenId: string,
  areas: Area[],
  punto: string,
  meta: number,
  hecho: number,
  usuario: UsuarioSync,
): Promise<AvanceAreaSync[]> {
  const salida: AvanceAreaSync[] = [];

  for (const area of areas) {
    const { rows: comps } = await query<{ comp_idx: number; nombre: string; meta: number; hecho: number }>(
      'SELECT comp_idx, nombre, meta, hecho FROM avances WHERE orden_id = $1 AND area = $2 ORDER BY comp_idx',
      [ordenId, area],
    );
    const comp = comps[0];
    if (!comp) continue;

    const previo = Number(comp.hecho);

    // El nombre se refresca también: así las órdenes creadas antes de que el
    // área tuviera hoja muestran el punto de reporte actual.
    if (meta !== Number(comp.meta) || hecho !== previo || punto !== comp.nombre) {
      await query(
        'UPDATE avances SET nombre = $4, meta = $5, hecho = $6 WHERE orden_id = $1 AND area = $2 AND comp_idx = $3',
        [ordenId, area, comp.comp_idx, punto, meta, hecho],
      );
    }

    // Bitácora: solo cuando cambian las operaciones terminadas.
    if (hecho !== previo) {
      const { rows: ult } = await query<{ id: string }>(
        `SELECT id FROM reportes
          WHERE orden_id = $1 AND area = $2 AND comp_idx = $3 AND usuario_email = $4
            AND creado_en > NOW() - ($5 || ' minutes')::interval
          ORDER BY creado_en DESC LIMIT 1`,
        [ordenId, area, comp.comp_idx, usuario.email, VENTANA_FUSION_MIN],
      );
      const delta = hecho - previo;
      if (ult.length > 0) {
        await query('UPDATE reportes SET hecho = $2, delta = delta + $3 WHERE id = $1', [
          ult[0].id, hecho, delta,
        ]);
      } else {
        await query(
          `INSERT INTO reportes (orden_id, area, comp_idx, nombre, hecho, delta, usuario_email, usuario_nombre)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ordenId, area, comp.comp_idx, punto, hecho, delta, usuario.email, usuario.nombre],
        );
      }
    }

    salida.push({ area, componentes: [{ nombre: punto, meta, hecho }] });
  }

  return salida;
}

/** Small y Tips: el 100 % son todos los RENGLONES de la hoja marcados. */
export async function sincronizarDesdeHojaMaterial(ordenId: string, usuario: UsuarioSync) {
  const { rows } = await query<{ total: number; listos: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE terminado)::int AS listos
       FROM ${TABLA.material} WHERE orden_id = $1`,
    [ordenId],
  );
  const total = Number(rows[0]?.total ?? 0);
  const listos = Number(rows[0]?.listos ?? 0);
  // Con la hoja vacía queda 1 pendiente: el área no se da por terminada (ni
  // dispara el cierre de la orden) sin haber capturado nada.
  const meta = Math.max(1, total);
  return aplicarAAreas(ordenId, AREAS_HOJA_MATERIAL, PUNTO_HOJA_MATERIAL, meta, Math.min(meta, listos), usuario);
}

/**
 * Big y Tapa: el 100 % son todas las ACTIVIDADES de la orden marcadas (BASE,
 * UNIÓN, TAPA…), sumando todos los días y operarios. Así el número de hojas
 * entregadas no altera el cálculo: solo cuentan las actividades distintas.
 */
export async function sincronizarDesdeHojaRawbag(ordenId: string, usuario: UsuarioSync) {
  const { rows } = await query<{ total: number; listas: number }>(
    `WITH acts AS (
       SELECT DISTINCT UPPER(TRIM(actividad)) AS actividad
         FROM ${TABLA.rawbag}
        WHERE orden_id = $1 AND TRIM(actividad) <> ''
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM hoja_rawbag_actividad t
                 WHERE t.orden_id = $1
                   AND UPPER(TRIM(t.actividad)) = acts.actividad
                   AND t.terminado
              )
            )::int AS listas
       FROM acts`,
    [ordenId],
  );
  const total = Number(rows[0]?.total ?? 0);
  const listas = Number(rows[0]?.listas ?? 0);
  const meta = Math.max(1, total);
  return aplicarAAreas(ordenId, AREAS_HOJA_RAWBAG, PUNTO_HOJA_RAWBAG, meta, Math.min(meta, listas), usuario);
}

/**
 * Calidad: el 100 % son los sacos de la orden revisados en las mesas. Se suman
 * los conteos de TODAS las hojas (días y turnos), así que el número de hojas
 * entregadas tampoco altera el cálculo. Solo cuentan las mesas ACTIVAS: una
 * mesa sin sus dos operadores no se puede activar, y por tanto no suma.
 */
export async function sincronizarDesdeHojaCalidad(ordenId: string, usuario: UsuarioSync) {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(
              CASE WHEN m1_activa THEN m1_total ELSE 0 END +
              CASE WHEN m2_activa THEN m2_total ELSE 0 END +
              CASE WHEN m3_activa THEN m3_total ELSE 0 END +
              CASE WHEN m4_activa THEN m4_total ELSE 0 END
            ), 0)::int AS total
       FROM ${TABLA.calidad} WHERE orden_id = $1`,
    [ordenId],
  );
  const { rows: ord } = await query<{ cantidad: number }>(
    'SELECT cantidad FROM ordenes WHERE id = $1',
    [ordenId],
  );
  // La meta son los sacos de la orden (todos pasan por las mesas).
  const meta = Math.max(1, Number(ord[0]?.cantidad ?? 0));
  const hecho = Math.min(meta, Number(rows[0]?.total ?? 0));
  return aplicarAAreas(ordenId, AREAS_HOJA_CALIDAD, PUNTO_HOJA_CALIDAD, meta, hecho, usuario);
}

/**
 * Empaque: el 100 % son los sacos de la orden prensados en tarimas. Se suman
 * los conteos de todas las tarimas de la orden (la hoja física agrupa 5, pero
 * el cálculo no depende de cuántas hojas se entreguen).
 */
export async function sincronizarDesdeHojaEmpaque(ordenId: string, usuario: UsuarioSync) {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(contados), 0)::int AS total
       FROM ${TABLA.empaque} WHERE orden_id = $1`,
    [ordenId],
  );
  const { rows: ord } = await query<{ cantidad: number }>(
    'SELECT cantidad FROM ordenes WHERE id = $1',
    [ordenId],
  );
  const meta = Math.max(1, Number(ord[0]?.cantidad ?? 0));
  const hecho = Math.min(meta, Number(rows[0]?.total ?? 0));
  return aplicarAAreas(ordenId, AREAS_HOJA_EMPAQUE, PUNTO_HOJA_EMPAQUE, meta, hecho, usuario);
}

/**
 * Almacén: el 100 % son los sacos de la orden con su material ya entregado a
 * producción. Se suman las cantidades de todas las entregas (una hoja por
 * salida de almacén).
 */
export async function sincronizarDesdeHojaAlmacen(ordenId: string, usuario: UsuarioSync) {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cantidad_entregada), 0)::int AS total
       FROM ${TABLA.almacen} WHERE orden_id = $1`,
    [ordenId],
  );
  const { rows: ord } = await query<{ cantidad: number }>(
    'SELECT cantidad FROM ordenes WHERE id = $1',
    [ordenId],
  );
  const meta = Math.max(1, Number(ord[0]?.cantidad ?? 0));
  const hecho = Math.min(meta, Number(rows[0]?.total ?? 0));
  return aplicarAAreas(ordenId, AREAS_HOJA_ALMACEN, PUNTO_HOJA_ALMACEN, meta, hecho, usuario);
}

/** Big y Tapa capturan la hoja de Raw Bag; Small y Tips la de material. */
export function puedeEditarHojaDeAreas(
  actor: { rol: string; area_asignada: string | null },
  areas: Area[],
): boolean {
  return (
    actor.rol === 'admin' ||
    (actor.rol === 'supervisor' && !!actor.area_asignada && areas.includes(actor.area_asignada as Area))
  );
}
