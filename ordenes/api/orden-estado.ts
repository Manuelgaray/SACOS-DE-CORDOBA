import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

const ESTADOS = ['activa', 'programada', 'pausada', 'terminada', 'cancelada'];

// POST /api/ordenes/[id]/estado — cambia el status de una orden. SOLO ADMIN.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo un administrador puede cambiar el estado de una orden' },
      { status: 403 },
    );
  }

  let body: { estado?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const estado = body.estado ?? '';
  if (!ESTADOS.includes(estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }

  // Fechas reales para el calendario de producción:
  //  → activa:    fija fecha_inicio la PRIMERA vez (y borra fecha_fin si se reabre)
  //  → terminada: fija fecha_fin
  const { rows } = await query<{ fecha_inicio: Date | string | null; fecha_fin: Date | string | null }>(
    `UPDATE ordenes SET
       status = $2,
       fecha_inicio = CASE WHEN $2 = 'activa' THEN COALESCE(fecha_inicio, NOW()) ELSE fecha_inicio END,
       fecha_fin    = CASE WHEN $2 = 'terminada' THEN NOW()
                           WHEN $2 = 'activa'    THEN NULL
                           ELSE fecha_fin END
     WHERE id = $1
     RETURNING fecha_inicio, fecha_fin`,
    [params.id, estado],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }

  const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
  return NextResponse.json({
    ok: true,
    fecha_inicio: iso(rows[0].fecha_inicio),
    fecha_fin: iso(rows[0].fecha_fin),
  });
}
