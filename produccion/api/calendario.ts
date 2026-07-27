import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/calendario?mes=YYYY-MM — datos del calendario de producción:
//  - órdenes que iniciaron, terminaron o tuvieron reportes en el mes
//  - todos los reportes de la bitácora del mes (quién/cuándo/cuánto)
// Visible para cualquier usuario autenticado.
export async function GET(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const url = new URL(req.url);
  const mes = url.searchParams.get('mes') ?? '';
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Mes inválido (usa YYYY-MM)' }, { status: 400 });
  }
  const desde = `${mes}-01`;

  const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

  // Órdenes con actividad en el mes (inicio, fin o reportes dentro del rango).
  const { rows: ordRows } = await query<{
    id: string;
    numero_orden: string;
    cliente: string;
    cantidad: number;
    status: string;
    fecha_inicio: Date | string | null;
    fecha_fin: Date | string | null;
  }>(
    `SELECT DISTINCT o.id, o.numero_orden, o.cliente, o.cantidad, o.status,
            o.fecha_inicio, o.fecha_fin
       FROM ordenes o
       LEFT JOIN reportes r ON r.orden_id = o.id
        AND r.creado_en >= $1::date AND r.creado_en < ($1::date + INTERVAL '1 month')
      WHERE (o.fecha_inicio >= $1::date AND o.fecha_inicio < ($1::date + INTERVAL '1 month'))
         OR (o.fecha_fin    >= $1::date AND o.fecha_fin    < ($1::date + INTERVAL '1 month'))
         OR r.id IS NOT NULL`,
    [desde],
  );

  // Bitácora del mes (con número de orden y la meta del componente, para poder
  // mostrar "300 de 10,000" en el detalle).
  const { rows: repRows } = await query<{
    orden_id: string;
    numero_orden: string;
    area: string;
    comp_idx: number;
    nombre: string;
    hecho: number;
    delta: number;
    meta: number | null;
    usuario_nombre: string | null;
    creado_en: Date | string;
  }>(
    `SELECT r.orden_id, o.numero_orden, r.area, r.comp_idx, r.nombre,
            r.hecho, r.delta, a.meta, r.usuario_nombre, r.creado_en
       FROM reportes r
       JOIN ordenes o ON o.id = r.orden_id
       LEFT JOIN avances a ON a.orden_id = r.orden_id AND a.area = r.area AND a.comp_idx = r.comp_idx
      WHERE r.creado_en >= $1::date AND r.creado_en < ($1::date + INTERVAL '1 month')
      ORDER BY r.creado_en`,
    [desde],
  );

  return NextResponse.json({
    ordenes: ordRows.map((o) => ({
      id: o.id,
      numero_orden: o.numero_orden,
      cliente: o.cliente,
      cantidad: Number(o.cantidad),
      status: o.status,
      fecha_inicio: iso(o.fecha_inicio),
      fecha_fin: iso(o.fecha_fin),
    })),
    reportes: repRows.map((r) => ({
      orden_id: r.orden_id,
      numero_orden: r.numero_orden,
      area: r.area,
      comp_idx: Number(r.comp_idx),
      nombre: r.nombre,
      hecho: Number(r.hecho),
      delta: Number(r.delta),
      meta: r.meta == null ? null : Number(r.meta),
      usuario_nombre: r.usuario_nombre,
      creado_en: iso(r.creado_en),
    })),
  });
}
