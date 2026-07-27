import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaCalidad, puedeEditarHojaDeAreas, AREAS_HOJA_CALIDAD,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La hoja física (PRO-FOR-015) trae 4 mesas y una retícula de 1 a 175 por mesa.
export const MESAS = [1, 2, 3, 4] as const;
export const MAX_MESA = 175;

// El control de mesas de calidad lo captura el supervisor de Calidad (o el admin).
export const puedeEditarCalidad = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_CALIDAD);

export const ERROR_PERMISO = 'Solo el supervisor de Calidad (o el admin) captura esta hoja';

export const COLS_CALIDAD = `
  id, fecha::text AS fecha, turno, supervisor, observaciones,
  m1_op1, m1_op2, m1_activa, m1_total,
  m2_op1, m2_op2, m2_activa, m2_total,
  m3_op1, m3_op2, m3_activa, m3_total,
  m4_op1, m4_op2, m4_activa, m4_total
`;

export type FilaCalidad = Record<string, unknown> & { id: number | string; fecha: string };

export interface MesaCalidad { op1: string; op2: string; activa: boolean; total: number }

export function mapCalidad(r: FilaCalidad) {
  return {
    id: Number(r.id),
    fecha: String(r.fecha),
    turno: String(r.turno ?? ''),
    supervisor: String(r.supervisor ?? ''),
    observaciones: String(r.observaciones ?? ''),
    mesas: MESAS.map<MesaCalidad>((m) => ({
      op1: String(r[`m${m}_op1`] ?? ''),
      op2: String(r[`m${m}_op2`] ?? ''),
      activa: !!r[`m${m}_activa`],
      total: Number(r[`m${m}_total`] ?? 0),
    })),
  };
}

/**
 * Normaliza las 4 mesas que manda el cliente. Regla de planta: una mesa la
 * trabajan DOS personas, así que sin sus dos operadores no se puede activar
 * (y una mesa inactiva no suma al avance del área).
 */
export function mesasDeBody(body: Record<string, unknown>): MesaCalidad[] {
  const raw = Array.isArray(body.mesas) ? (body.mesas as Record<string, unknown>[]) : [];
  return MESAS.map((_, i) => {
    const m = raw[i] ?? {};
    const op1 = String(m.op1 ?? '').trim();
    const op2 = String(m.op2 ?? '').trim();
    const completa = op1 !== '' && op2 !== '';
    const total = Math.round(Number(m.total) || 0);
    return {
      op1,
      op2,
      activa: completa && !!m.activa,
      total: Math.max(0, Math.min(MAX_MESA, total)),
    };
  });
}

// GET /api/hoja-calidad?orden=ID — todas las hojas de la orden (todos los días).
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaCalidad>(
    `SELECT ${COLS_CALIDAD} FROM hoja_calidad WHERE orden_id = $1 ORDER BY fecha, id`,
    [ordenId],
  );
  return NextResponse.json({ hojas: rows.map(mapCalidad) });
}

// POST /api/hoja-calidad — abre una hoja nueva (un día/turno de mesas).
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarCalidad(actor)) {
    return NextResponse.json({ error: ERROR_PERMISO }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? '');
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const regla = await reglasOrden(ordenId);
  if (regla) return NextResponse.json({ error: regla }, { status: 409 });

  const fechaTexto = String(body.fecha ?? '');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto) ? fechaTexto : null;

  const { rows } = await query<FilaCalidad>(
    `INSERT INTO hoja_calidad (orden_id, fecha, turno, supervisor, capturado_por)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5)
     RETURNING ${COLS_CALIDAD}`,
    [ordenId, fecha, String(body.turno ?? ''), actor.nombre, actor.nombre],
  );

  const avances = await sincronizarDesdeHojaCalidad(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ hoja: mapCalidad(rows[0]), avances, ...cierre }, { status: 201 });
}
