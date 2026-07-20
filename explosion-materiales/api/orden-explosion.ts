import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { normalizarElementos } from '@/explosion-materiales/explosion';

export const runtime = 'nodejs';

async function rolDe(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string }>('SELECT rol FROM usuarios WHERE email = $1', [email]);
  return rows[0]?.rol;
}

// PUT /api/ordenes/[id]/explosion — guarda los elementos de corte (columna JSONB)
// y SINCRONIZA la captura del área de corte: lo que la orden lleva según la
// explosión (laterales, base, válvulas, cintas…) es lo que aparece para capturar
// en Producción → Corte. El avance ya reportado se conserva por nombre.
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

  const { rows: upd } = await query<{ cantidad: number }>(
    'UPDATE ordenes SET corte_elementos = $2::jsonb WHERE id = $1 RETURNING cantidad',
    [params.id, JSON.stringify(elementos)],
  );
  if (upd.length === 0) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }
  const cantidad = Number(upd[0].cantidad) || 0;

  // ── Sincronizar el área de corte con la explosión ──────────────────────────
  // Conservamos el "hecho" ya capturado emparejando por nombre; los elementos
  // eliminados de la explosión desaparecen de la captura y los nuevos entran en 0.
  const { rows: previos } = await query<{ nombre: string; hecho: number }>(
    `SELECT nombre, hecho FROM avances WHERE orden_id = $1 AND area = 'corte'`,
    [params.id],
  );
  const hechoPorNombre = new Map(previos.map((r) => [r.nombre, Number(r.hecho)]));

  await query(`DELETE FROM avances WHERE orden_id = $1 AND area = 'corte'`, [params.id]);

  const validos = elementos.filter((e) => e.nombre.trim() !== '' && e.piezasPorSaco > 0);
  const corte: { nombre: string; meta: number; hecho: number }[] = [];
  for (let i = 0; i < validos.length; i++) {
    const e = validos[i];
    const meta = e.piezasPorSaco * cantidad;
    const hecho = Math.min(hechoPorNombre.get(e.nombre) ?? 0, meta);
    await query(
      `INSERT INTO avances (orden_id, area, comp_idx, nombre, meta, hecho)
       VALUES ($1, 'corte', $2, $3, $4, $5)`,
      [params.id, i, e.nombre, meta, hecho],
    );
    corte.push({ nombre: e.nombre, meta, hecho });
  }

  return NextResponse.json({ ok: true, elementos, corte });
}
