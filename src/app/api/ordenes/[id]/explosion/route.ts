import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { normalizarElementos } from '@/lib/explosion';

export const runtime = 'nodejs';

async function rolDe(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string }>('SELECT rol FROM usuarios WHERE email = $1', [email]);
  return rows[0]?.rol;
}

// PUT /api/ordenes/[id]/explosion — guarda los elementos de corte (columna JSONB).
// Solo admin/diseño pueden editar; el header `x-user-email` identifica al usuario.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const rol = await rolDe(email);
  if (!email || !rol) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (rol !== 'admin' && rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para editar el corte' }, { status: 403 });
  }

  let body: { elementos?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const elementos = normalizarElementos(body.elementos);

  const { rowCount } = await query(
    'UPDATE ordenes SET corte_elementos = $2::jsonb WHERE id = $1',
    [params.id, JSON.stringify(elementos)],
  );
  if (!rowCount) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, elementos });
}
