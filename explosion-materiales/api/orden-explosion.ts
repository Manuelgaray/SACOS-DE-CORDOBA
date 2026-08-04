import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { normalizarElementos } from '@/explosion-materiales/explosion';
import { metasDeArea, type AvanceArea } from '@/produccion/produccion';
import { AREAS_FLOW } from '@/compartido/mock-data';

export const runtime = 'nodejs';

async function rolDe(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const { rows } = await query<{ rol: string }>('SELECT rol FROM usuarios WHERE email = $1', [email]);
  return rows[0]?.rol;
}

// PUT /api/ordenes/[id]/explosion — guarda los elementos de corte (columna JSONB)
// y SINCRONIZA la captura de TODAS las áreas: lo que la orden lleva según la
// explosión define qué reporta almacén (materiales), corte (piezas), small
// (dobladillos), tips (costuras/ensambles), big (uniones) y tapa (cierre).
// El avance ya reportado se conserva emparejando por nombre del punto.
// SOLO UN ADMINISTRADOR puede modificarla en una orden ya creada: cambiarla
// mueve las cuentas y los puntos de reporte de todas las áreas.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const email = (req.headers.get('x-user-email') ?? '').trim().toLowerCase();
  const rol = await rolDe(email);
  if (!email || !rol) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo un administrador puede modificar la explosión de una orden' },
      { status: 403 },
    );
  }

  let body: { elementos?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  const elementos = normalizarElementos(body.elementos);

  const { rows: upd } = await query<{ cantidad: number; tipo_saco: string }>(
    'UPDATE ordenes SET corte_elementos = $2::jsonb WHERE id = $1 RETURNING cantidad, tipo_saco',
    [params.id, JSON.stringify(elementos)],
  );
  if (upd.length === 0) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }

  const ordenBase = {
    cantidad: Number(upd[0].cantidad) || 0,
    tipo_saco: upd[0].tipo_saco,
    corte_elementos: elementos,
  };

  // ── Re-sincronizar TODAS las áreas con la explosión ────────────────────────
  // Conservamos el "hecho" ya capturado emparejando por (área, nombre); los
  // puntos eliminados desaparecen y los nuevos entran en 0.
  const { rows: previos } = await query<{ area: string; nombre: string; hecho: number }>(
    'SELECT area, nombre, hecho FROM avances WHERE orden_id = $1',
    [params.id],
  );
  const hechoPor = new Map(previos.map((r) => [`${r.area}|${r.nombre}`, Number(r.hecho)]));

  await query('DELETE FROM avances WHERE orden_id = $1', [params.id]);

  const avances: AvanceArea[] = [];
  for (const area of AREAS_FLOW) {
    const metas = metasDeArea(ordenBase, area);
    if (metas.length === 0) continue; // área sin puntos para esta orden
    const componentes = [];
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i];
      const hecho = Math.min(hechoPor.get(`${area}|${m.nombre}`) ?? 0, m.meta);
      await query(
        `INSERT INTO avances (orden_id, area, comp_idx, nombre, meta, hecho)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [params.id, area, i, m.nombre, m.meta, hecho],
      );
      componentes.push({ nombre: m.nombre, meta: m.meta, hecho });
    }
    avances.push({ area, componentes });
  }

  return NextResponse.json({ ok: true, elementos, avances });
}
