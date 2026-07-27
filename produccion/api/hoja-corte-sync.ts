// ─────────────────────────────────────────────────────────────────────────────
//  Sincronización HOJA DE CORTE → avance de Corte + bitácora (solo servidor).
//
//  La hoja es la fuente de la verdad del área de corte: los totales de piezas
//  por elemento (sumando TODAS las hojas/días de la orden) se vuelcan sobre los
//  componentes del avance, emparejando nombres (Lateral↔Laterales,
//  Inlet↔Válvula de carga, Banda↔Cinturones…). Cada cambio queda en la
//  bitácora con la misma ventana de fusión que la captura normal.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';
import { coincideElementoHoja } from '@/produccion/produccion';

const VENTANA_FUSION_MIN = 10;

export interface UsuarioSync {
  email: string;
  nombre: string;
}

export async function sincronizarCorteDesdeHoja(
  ordenId: string,
  usuario: UsuarioSync,
): Promise<{ nombre: string; meta: number; hecho: number }[]> {
  const { rows: totales } = await query<{ elemento: string; total: number }>(
    'SELECT elemento, SUM(piezas)::int AS total FROM hoja_corte WHERE orden_id = $1 GROUP BY elemento',
    [ordenId],
  );

  const { rows: comps } = await query<{ comp_idx: number; nombre: string; meta: number; hecho: number }>(
    `SELECT comp_idx, nombre, meta, hecho FROM avances
      WHERE orden_id = $1 AND area = 'corte' ORDER BY comp_idx`,
    [ordenId],
  );

  const resultado: { nombre: string; meta: number; hecho: number }[] = [];

  for (const comp of comps) {
    const suma = totales
      .filter((t) => coincideElementoHoja(comp.nombre, t.elemento))
      .reduce((s, t) => s + Number(t.total), 0);
    const meta = Number(comp.meta);
    const previo = Number(comp.hecho);
    const nuevo = Math.min(meta, Math.max(0, suma));
    resultado.push({ nombre: comp.nombre, meta, hecho: nuevo });

    if (nuevo === previo) continue;

    await query(
      `UPDATE avances SET hecho = $3 WHERE orden_id = $1 AND area = 'corte' AND comp_idx = $2`,
      [ordenId, comp.comp_idx, nuevo],
    );

    // Bitácora (con ventana de fusión, igual que la captura normal).
    const { rows: ult } = await query<{ id: string }>(
      `SELECT id FROM reportes
        WHERE orden_id = $1 AND area = 'corte' AND comp_idx = $2 AND usuario_email = $3
          AND creado_en > NOW() - ($4 || ' minutes')::interval
        ORDER BY creado_en DESC LIMIT 1`,
      [ordenId, comp.comp_idx, usuario.email, VENTANA_FUSION_MIN],
    );
    const delta = nuevo - previo;
    if (ult.length > 0) {
      await query('UPDATE reportes SET hecho = $2, delta = delta + $3 WHERE id = $1', [
        ult[0].id, nuevo, delta,
      ]);
    } else {
      await query(
        `INSERT INTO reportes (orden_id, area, comp_idx, nombre, hecho, delta, usuario_email, usuario_nombre)
         VALUES ($1, 'corte', $2, $3, $4, $5, $6, $7)`,
        [ordenId, comp.comp_idx, comp.nombre, nuevo, delta, usuario.email, usuario.nombre],
      );
    }
  }

  return resultado;
}

// ── Validaciones compartidas de las rutas de la hoja ───────────────────────────

export async function actorHoja(req: Request) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query<{ email: string; nombre: string; rol: string; area_asignada: string | null }>(
    'SELECT email, nombre, rol, area_asignada FROM usuarios WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export function puedeEditarHoja(actor: { rol: string; area_asignada: string | null }): boolean {
  return actor.rol === 'admin' || (actor.rol === 'supervisor' && actor.area_asignada === 'corte');
}

/** Reglas de la orden para mutar la hoja: debe estar ACTIVA y AUTORIZADA. */
export async function reglasOrden(ordenId: string): Promise<string | null> {
  const { rows } = await query<{ status: string; autorizado_por: string | null }>(
    'SELECT status, autorizado_por FROM ordenes WHERE id = $1',
    [ordenId],
  );
  const o = rows[0];
  if (!o) return 'Orden no encontrada';
  if (o.status !== 'activa') return `La orden está ${o.status}; solo se captura cuando está activa`;
  if (!o.autorizado_por) return 'La orden aún no ha sido autorizada por un administrador';
  return null;
}

// Mapea una fila de la base al shape que consume la pantalla.
export interface RenglonHoja {
  id: number;
  fecha: string;
  operador: string;
  maquina: string;
  hora: string;
  rollo: string;
  elemento: string;
  medidaSpec: string;
  medidaReal: string;
  materialSpec: string;
  materialReal: string;
  laminado: boolean;
  diamSpec: string;
  diamReal: string;
  piezas: number;
  firma: string;
  pc: boolean;
}

// Fila cruda como sale de PostgreSQL (COLS_HOJA).
export interface FilaHoja {
  id: number | string;
  fecha: string;
  operador: string;
  maquina: string;
  hora: string;
  rollo: string;
  elemento: string;
  medida_spec: string;
  medida_real: string;
  material_spec: string;
  material_real: string;
  laminado: boolean;
  diam_spec: string;
  diam_real: string;
  piezas: number | string;
  firma: string;
  pc: boolean;
}

export function mapRenglon(r: FilaHoja): RenglonHoja {
  return {
    id: Number(r.id),
    fecha: String(r.fecha),
    operador: r.operador,
    maquina: r.maquina,
    hora: r.hora,
    rollo: r.rollo,
    elemento: r.elemento,
    medidaSpec: r.medida_spec,
    medidaReal: r.medida_real,
    materialSpec: r.material_spec,
    materialReal: r.material_real,
    laminado: !!r.laminado,
    diamSpec: r.diam_spec,
    diamReal: r.diam_real,
    piezas: Number(r.piezas),
    firma: r.firma,
    pc: !!r.pc,
  };
}

export const COLS_HOJA = `
  id, orden_id, fecha::text AS fecha, operador, maquina, hora, rollo, elemento,
  medida_spec, medida_real, material_spec, material_real, laminado,
  diam_spec, diam_real, piezas, firma, pc
`;
