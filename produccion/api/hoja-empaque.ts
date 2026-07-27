import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorHoja, reglasOrden } from '@/produccion/api/hoja-corte-sync';
import {
  sincronizarDesdeHojaEmpaque, puedeEditarHojaDeAreas, AREAS_HOJA_EMPAQUE,
} from '@/produccion/api/sync-operaciones';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La retícula del papel llega a 200 sacos por tarima.
export const MAX_TARIMA = 200;

// El control de tarimas lo captura el supervisor de Empaque (o el admin).
export const puedeEditarEmpaque = (actor: { rol: string; area_asignada: string | null }) =>
  puedeEditarHojaDeAreas(actor, AREAS_HOJA_EMPAQUE);

export const ERROR_PERMISO = 'Solo el supervisor de Empaque (o el admin) captura esta hoja';

export const COLS_EMPAQUE = `
  id, numero, fecha::text AS fecha, turno, contados, peso
`;

export interface FilaEmpaque {
  id: number | string;
  numero: number | string;
  fecha: string;
  turno: string;
  contados: number | string;
  peso: number | string;
}

export function mapEmpaque(r: FilaEmpaque) {
  return {
    id: Number(r.id),
    numero: Number(r.numero),
    fecha: String(r.fecha),
    turno: String(r.turno ?? ''),
    contados: Number(r.contados),
    peso: Number(r.peso),
  };
}

// GET /api/hoja-empaque?orden=ID — todas las tarimas de la orden.
export async function GET(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ordenId = new URL(req.url).searchParams.get('orden') ?? '';
  if (!ordenId) return NextResponse.json({ error: 'Falta la orden' }, { status: 400 });

  const { rows } = await query<FilaEmpaque>(
    `SELECT ${COLS_EMPAQUE} FROM hoja_empaque WHERE orden_id = $1 ORDER BY numero, id`,
    [ordenId],
  );
  return NextResponse.json({ tarimas: rows.map(mapEmpaque) });
}

// POST /api/hoja-empaque — abre una tarima nueva (se numera sola, consecutiva).
export async function POST(req: Request) {
  const actor = await actorHoja(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!puedeEditarEmpaque(actor)) {
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

  const { rows } = await query<FilaEmpaque>(
    `INSERT INTO hoja_empaque (orden_id, numero, fecha, turno, capturado_por)
     VALUES (
       $1,
       (SELECT COALESCE(MAX(numero), 0) + 1 FROM hoja_empaque WHERE orden_id = $1),
       COALESCE($2::date, CURRENT_DATE), $3, $4
     )
     RETURNING ${COLS_EMPAQUE}`,
    [ordenId, fecha, String(body.turno ?? ''), actor.nombre],
  );

  const avances = await sincronizarDesdeHojaEmpaque(ordenId, actor);
  const cierre = await cerrarOrdenSiCompleta(ordenId);
  return NextResponse.json({ tarima: mapEmpaque(rows[0]), avances, ...cierre }, { status: 201 });
}
