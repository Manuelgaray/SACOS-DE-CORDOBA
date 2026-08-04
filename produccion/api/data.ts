import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { rowToOrden, ORDEN_COLS, type OrdenRow } from '@/ordenes/orden-map';
import { generarAvance } from '@/produccion/produccion';
import { avancesDeOrdenes } from '@/produccion/api/avances-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ventana de trabajo: además de lo que sigue en piso, se conservan las órdenes
// cerradas hace poco (para consultarlas sin ir al listado completo).
const DIAS_RECIENTES = 60;

// GET /api/data — el CONJUNTO DE TRABAJO que carga el store: lo que está en
// producción más lo terminado hace poco. El histórico completo no se trae aquí;
// vive en el listado paginado (/api/ordenes) y en el detalle de cada orden.
// Así el refresco periódico se mantiene barato aunque la planta acumule años.
export async function GET() {
  const { rows: ordenRows } = await query<OrdenRow>(
    `SELECT ${ORDEN_COLS} FROM ordenes
      WHERE status IN ('activa', 'programada', 'pausada')
         OR fecha_creacion > NOW() - ($1 || ' days')::interval
         OR fecha_fin      > NOW() - ($1 || ' days')::interval
      ORDER BY fecha_creacion DESC`,
    [DIAS_RECIENTES],
  );
  const ordenes = ordenRows.map(rowToOrden);
  const ids = ordenes.map(o => o.id);

  // Backfill: las órdenes sin filas de avance (p. ej. las sembradas por SQL)
  // generan sus avances la primera vez y se guardan.
  const { rows: conAvancesRows } = await query<{ orden_id: string }>(
    'SELECT DISTINCT orden_id FROM avances WHERE orden_id = ANY($1::text[])',
    [ids],
  );
  const conAvances = new Set(conAvancesRows.map(r => r.orden_id));
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
      }
    }
  }

  const avances = await avancesDeOrdenes(ids);
  return NextResponse.json({ ordenes, avances });
}
