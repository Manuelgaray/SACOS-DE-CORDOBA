// ─────────────────────────────────────────────────────────────────────────────
//  Armado de avances por orden (solo servidor).
//
//  Las filas planas de `avances` se agrupan en AvanceArea[] por orden, en el
//  orden del flujo de producción, y se les pega el último reporte de la
//  bitácora. Lo usan el store (/api/data), el listado paginado y el detalle.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';
import { type AvanceArea } from '@/produccion/produccion';
import { AREAS_FLOW, type Area } from '@/compartido/mock-data';

interface AvanceRow {
  orden_id: string;
  area: string;
  comp_idx: number;
  nombre: string;
  meta: number;
  hecho: number;
}

/** Avances de las órdenes indicadas. Con la lista vacía no consulta nada. */
export async function avancesDeOrdenes(ids: string[]): Promise<Record<string, AvanceArea[]>> {
  if (ids.length === 0) return {};

  const { rows: avRows } = await query<AvanceRow>(
    `SELECT orden_id, area, comp_idx, nombre, meta, hecho
       FROM avances WHERE orden_id = ANY($1::text[])
      ORDER BY orden_id, area, comp_idx`,
    [ids],
  );

  // Último reporte por (orden, área): cuándo y quién reportó.
  const { rows: ultRows } = await query<{
    orden_id: string; area: string; creado_en: Date | string; usuario_nombre: string | null;
  }>(
    `SELECT DISTINCT ON (orden_id, area) orden_id, area, creado_en, usuario_nombre
       FROM reportes WHERE orden_id = ANY($1::text[])
      ORDER BY orden_id, area, creado_en DESC`,
    [ids],
  );
  const ultimoPor = new Map(
    ultRows.map(u => [
      `${u.orden_id}|${u.area}`,
      { fecha: new Date(u.creado_en).toISOString(), usuario: u.usuario_nombre },
    ]),
  );

  const avances: Record<string, AvanceArea[]> = {};
  for (const r of avRows) {
    const list = (avances[r.orden_id] ??= []);
    let area = list.find(a => a.area === r.area);
    if (!area) {
      area = {
        area: r.area as Area,
        componentes: [],
        ultimoReporte: ultimoPor.get(`${r.orden_id}|${r.area}`),
      };
      list.push(area);
    }
    area.componentes.push({ nombre: r.nombre, meta: Number(r.meta), hecho: Number(r.hecho) });
  }
  for (const id of Object.keys(avances)) {
    avances[id].sort((a, b) => AREAS_FLOW.indexOf(a.area) - AREAS_FLOW.indexOf(b.area));
  }
  return avances;
}
