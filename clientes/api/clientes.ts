import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { actorDe } from '@/autenticacion/auth-server';

export const runtime = 'nodejs';

// GET /api/clientes — registro maestro: cada cliente con sus specs.
// Cualquier usuario autenticado puede consultarlo (alimenta el autocompletado).
export async function GET(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { rows } = await query<{ nombre: string; specs: string[] | null }>(
    `SELECT c.nombre,
            ARRAY_REMOVE(ARRAY_AGG(s.spec ORDER BY s.spec), NULL) AS specs
       FROM clientes c
       LEFT JOIN specs s ON s.cliente = c.nombre
      GROUP BY c.nombre
      ORDER BY c.nombre`,
  );

  const clientes = rows.map((r) => ({ nombre: r.nombre, specs: r.specs ?? [] }));
  return NextResponse.json({ clientes });
}

// POST /api/clientes — registra un cliente nuevo (admin/diseño).
export async function POST(req: Request) {
  const actor = await actorDe(req);
  if (!actor) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (actor.rol !== 'admin' && actor.rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para editar el registro' }, { status: 403 });
  }

  let body: { nombre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const nombre = (body.nombre ?? '').trim();
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre del cliente es obligatorio' }, { status: 400 });
  }

  try {
    const { rowCount } = await query(
      'INSERT INTO clientes (nombre) VALUES ($1) ON CONFLICT DO NOTHING',
      [nombre],
    );
    if (!rowCount) {
      return NextResponse.json({ error: 'Ese cliente ya está registrado' }, { status: 409 });
    }
  } catch {
    // Índice único por LOWER(nombre): mismo nombre con otras mayúsculas.
    return NextResponse.json({ error: 'Ese cliente ya está registrado (con otra combinación de mayúsculas)' }, { status: 409 });
  }

  return NextResponse.json({ cliente: { nombre, specs: [] } }, { status: 201 });
}
