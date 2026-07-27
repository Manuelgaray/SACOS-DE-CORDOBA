import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { rowToOrden, ORDEN_COLS, type OrdenRow } from '@/ordenes/orden-map';
import { generarAvance, type AvanceArea } from '@/produccion/produccion';
import { AREAS_FLOW, type Area } from '@/compartido/mock-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AvanceRow {
  orden_id: string;
  area: string;
  comp_idx: number;
  nombre: string;
  meta: number;
  hecho: number;
}

// GET /api/data — todas las órdenes + sus avances (lo que carga el store).
export async function GET() {
  const { rows: ordenRows } = await query<OrdenRow>(
    `SELECT ${ORDEN_COLS} FROM ordenes ORDER BY fecha_creacion DESC`,
  );
  const ordenes = ordenRows.map(rowToOrden);

  const { rows: avRows } = await query<AvanceRow>(
    'SELECT orden_id, area, comp_idx, nombre, meta, hecho FROM avances ORDER BY orden_id, area, comp_idx',
  );

  // Backfill: las órdenes sin filas de avance (p. ej. las demo sembradas por SQL)
  // generan sus avances la primera vez y se guardan.
  const conAvances = new Set(avRows.map(r => r.orden_id));
  for (const orden of ordenes) {
    if (conAvances.has(orden.id)) continue;
    for (const av of generarAvance(orden)) {
      for (let i = 0; i < av.componentes.length; i++) {
        const c = av.componentes[i];
        await query(
          `INSERT INTO avances (orden_id, area, comp_idx, nombre, meta, hecho)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (orden_id, area, comp_idx) DO NOTHING`,
          [orden.id, av.area, i, c.nombre, c.meta, c.hecho],
        );
        avRows.push({ orden_id: orden.id, area: av.area, comp_idx: i, nombre: c.nombre, meta: c.meta, hecho: c.hecho });
      }
    }
  }

  // Último reporte de la bitácora por (orden, área): cuándo y quién reportó.
  const { rows: ultRows } = await query<{
    orden_id: string;
    area: string;
    creado_en: Date | string;
    usuario_nombre: string | null;
  }>(
    `SELECT DISTINCT ON (orden_id, area) orden_id, area, creado_en, usuario_nombre
       FROM reportes
      ORDER BY orden_id, area, creado_en DESC`,
  );
  const ultimoPor = new Map(
    ultRows.map(u => [
      `${u.orden_id}|${u.area}`,
      { fecha: new Date(u.creado_en).toISOString(), usuario: u.usuario_nombre },
    ]),
  );

  // Agrupar por orden → AvanceArea[], en el orden del flujo de producción.
  const avances: Record<string, AvanceArea[]> = {};
  for (const r of avRows) {
    const list = (avances[r.orden_id] ??= []);
    let area = list.find(a => a.area === r.area);
    if (!area) {
      area = { area: r.area as Area, componentes: [], ultimoReporte: ultimoPor.get(`${r.orden_id}|${r.area}`) };
      list.push(area);
    }
    area.componentes.push({ nombre: r.nombre, meta: Number(r.meta), hecho: Number(r.hecho) });
  }
  for (const id of Object.keys(avances)) {
    avances[id].sort((a, b) => AREAS_FLOW.indexOf(a.area) - AREAS_FLOW.indexOf(b.area));
  }

  return NextResponse.json({ ordenes, avances });
}
