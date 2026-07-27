// ─────────────────────────────────────────────────────────────────────────────
//  Cierre automático de la orden (solo servidor).
//
//  Cuando TODAS las áreas de la orden llegan al 100 % (no queda ningún
//  componente con hecho < meta), la orden pasa sola a "terminada" y se registra
//  su fecha/hora de fin. Se dispara con la captura de cualquier supervisor, así
//  que NO hace falta que haya un administrador conectado.
//
//  El admin conserva el control manual: puede cambiar el estado cuando quiera
//  (incluido reabrir una orden que se cerró sola). Aquí solo se cierra una orden
//  que esté "activa" — nunca se toca una pausada, cancelada o ya terminada.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/compartido/db';

export interface ResultadoCierre {
  ordenTerminada: boolean;
  fechaFin: string | null;
}

export async function cerrarOrdenSiCompleta(ordenId: string): Promise<ResultadoCierre> {
  const { rows } = await query<{ total: number; pendientes: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE hecho < meta)::int AS pendientes
       FROM avances WHERE orden_id = $1`,
    [ordenId],
  );

  const total = Number(rows[0]?.total ?? 0);
  const pendientes = Number(rows[0]?.pendientes ?? 0);
  // Sin componentes no hay nada que cerrar (evita cerrar órdenes vacías).
  if (total === 0 || pendientes > 0) {
    return { ordenTerminada: false, fechaFin: null };
  }

  const { rows: upd } = await query<{ fecha_fin: Date | string | null }>(
    `UPDATE ordenes SET status = 'terminada', fecha_fin = NOW()
      WHERE id = $1 AND status = 'activa'
      RETURNING fecha_fin`,
    [ordenId],
  );

  if (upd.length === 0) return { ordenTerminada: false, fechaFin: null };

  const f = upd[0].fecha_fin;
  return { ordenTerminada: true, fechaFin: f ? new Date(f).toISOString() : null };
}
