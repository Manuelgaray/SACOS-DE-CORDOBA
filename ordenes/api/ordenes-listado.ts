import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';
import { rowToOrden, ORDEN_COLS, type OrdenRow } from '@/ordenes/orden-map';
import { avancesDeOrdenes } from '@/produccion/api/avances-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// El listado de órdenes se pagina en el SERVIDOR: la pantalla nunca carga el
// histórico completo, solo la página que se está viendo (y los avances de esas
// órdenes, para las barras de progreso).

export const POR_PAGINA = 15;
const MAX_POR_PAGINA = 50;

const ESTADOS = ['activa', 'programada', 'pausada', 'terminada', 'cancelada'];

// GET /api/ordenes?pagina=1&limite=15&estado=activa&q=texto
export async function GET(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const url = new URL(req.url);
  const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') ?? '1', 10) || 1);
  const limite = Math.min(
    MAX_POR_PAGINA,
    Math.max(1, parseInt(url.searchParams.get('limite') ?? String(POR_PAGINA), 10) || POR_PAGINA),
  );
  const estado = url.searchParams.get('estado') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();

  // Filtros: se arman como parámetros, nunca concatenando lo que llega del cliente.
  const cond: string[] = [];
  const args: unknown[] = [];

  if (ESTADOS.includes(estado)) {
    args.push(estado);
    cond.push(`status = $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    const p = `$${args.length}`;
    cond.push(
      `(numero_orden ILIKE ${p} OR cliente ILIKE ${p} OR spec ILIKE ${p}
        OR tipo_saco ILIKE ${p} OR COALESCE(orden_cliente, '') ILIKE ${p})`,
    );
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const { rows: totalRows } = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ordenes ${where}`,
    args,
  );
  const total = Number(totalRows[0]?.n ?? 0);
  const paginas = Math.max(1, Math.ceil(total / limite));
  const actual = Math.min(pagina, paginas);

  const { rows } = await query<OrdenRow>(
    `SELECT ${ORDEN_COLS} FROM ordenes ${where}
      ORDER BY fecha_creacion DESC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, limite, (actual - 1) * limite],
  );
  const ordenes = rows.map(rowToOrden);

  // Conteo por estado para las pestañas (respeta la búsqueda, no el estado).
  const condSinEstado: string[] = [];
  const argsSinEstado: unknown[] = [];
  if (q) {
    argsSinEstado.push(`%${q}%`);
    const p = '$1';
    condSinEstado.push(
      `(numero_orden ILIKE ${p} OR cliente ILIKE ${p} OR spec ILIKE ${p}
        OR tipo_saco ILIKE ${p} OR COALESCE(orden_cliente, '') ILIKE ${p})`,
    );
  }
  const { rows: conteoRows } = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM ordenes
      ${condSinEstado.length ? `WHERE ${condSinEstado.join(' AND ')}` : ''}
      GROUP BY status`,
    argsSinEstado,
  );
  const conteos: Record<string, number> = { todas: 0 };
  for (const e of ESTADOS) conteos[e] = 0;
  for (const r of conteoRows) {
    conteos[r.status] = Number(r.n);
    conteos.todas += Number(r.n);
  }

  const avances = await avancesDeOrdenes(ordenes.map(o => o.id));

  return NextResponse.json({ ordenes, avances, total, paginas, pagina: actual, limite, conteos });
}
