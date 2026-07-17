import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

async function usuarioDe(email: string): Promise<{ rol: string; area_asignada: string | null } | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string; area_asignada: string | null }>(
    'SELECT rol, area_asignada FROM usuarios WHERE email = $1',
    [email],
  );
  return rows[0];
}

// POST /api/avances — reporta el "hecho" de un componente (captura de producción).
// La captura está gateada por perfil: admin (todas las áreas), supervisor (solo su
// área asignada); diseño es solo lectura. El header `x-user-email` identifica al
// usuario (mismo patrón que la ruta de explosión).
export async function POST(req: Request) {
  let body: { ordenId?: string; area?: string; compIdx?: number; valor?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const { ordenId, area } = body;
  const compIdx = Number(body.compIdx);
  if (!ordenId || !area || !Number.isInteger(compIdx)) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
  }

  // ── Autorización ──────────────────────────────────────────────────────────
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const usuario = await usuarioDe(email);
  if (!email || !usuario) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const permitido =
    usuario.rol === 'admin' ||
    (usuario.rol === 'supervisor' && usuario.area_asignada === area);
  if (!permitido) {
    return NextResponse.json(
      { error: 'No tienes permiso para capturar en esta área' },
      { status: 403 },
    );
  }

  const valor = Math.round(Number(body.valor) || 0);

  // Clamp a [0, meta] usando la meta de la propia fila.
  const { rows } = await query<{ hecho: number }>(
    `UPDATE avances
        SET hecho = LEAST(meta, GREATEST(0, $4::int))
      WHERE orden_id = $1 AND area = $2 AND comp_idx = $3
      RETURNING hecho`,
    [ordenId, area, compIdx, valor],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Componente no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ hecho: Number(rows[0].hecho) });
}
