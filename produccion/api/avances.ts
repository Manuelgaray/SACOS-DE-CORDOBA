import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { cerrarOrdenSiCompleta } from '@/produccion/api/cierre-automatico';

export const runtime = 'nodejs';

// Ventana de fusión de la bitácora: capturas seguidas del mismo usuario sobre el
// mismo componente (< 10 min) se consolidan en UN solo reporte, para que "el
// reporte de las 8:00" sea un renglón aunque haya tecleado varios números.
const VENTANA_FUSION_MIN = 10;

async function usuarioDe(email: string) {
  if (!email) return undefined;
  const { rows } = await query<{
    email: string;
    nombre: string;
    rol: string;
    area_asignada: string | null;
  }>('SELECT email, nombre, rol, area_asignada FROM usuarios WHERE email = $1', [email]);
  return rows[0];
}

// POST /api/avances — reporta el "hecho" de un componente (captura de producción).
// Además de actualizar el acumulado, registra el reporte en la BITÁCORA con
// fecha, hora, usuario y delta — la materia prima del calendario de producción.
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

  // ── Reglas de la orden ────────────────────────────────────────────────────
  // 1) Solo una orden ACTIVA acepta captura (programada/pausada no reciben datos).
  // 2) Sin la autorización de un administrador, la orden no procede.
  const { rows: ordRows } = await query<{ status: string; autorizado_por: string | null }>(
    'SELECT status, autorizado_por FROM ordenes WHERE id = $1',
    [ordenId],
  );
  const ord = ordRows[0];
  if (!ord) {
    return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
  }
  if (ord.status !== 'activa') {
    return NextResponse.json(
      { error: `La orden está ${ord.status}; solo se captura avance cuando está activa` },
      { status: 409 },
    );
  }
  if (!ord.autorizado_por) {
    return NextResponse.json(
      { error: 'La orden aún no ha sido autorizada por un administrador; no se puede capturar avance' },
      { status: 409 },
    );
  }

  // ── Actualizar el acumulado ───────────────────────────────────────────────
  const { rows: compRows } = await query<{ nombre: string; meta: number; hecho: number }>(
    'SELECT nombre, meta, hecho FROM avances WHERE orden_id = $1 AND area = $2 AND comp_idx = $3',
    [ordenId, area, compIdx],
  );
  const comp = compRows[0];
  if (!comp) {
    return NextResponse.json({ error: 'Componente no encontrado' }, { status: 404 });
  }

  const previo = Number(comp.hecho);
  const meta = Number(comp.meta);
  const nuevo = Math.min(meta, Math.max(0, Math.round(Number(body.valor) || 0)));

  let cierre = { ordenTerminada: false, fechaFin: null as string | null };

  if (nuevo !== previo) {
    await query(
      'UPDATE avances SET hecho = $4 WHERE orden_id = $1 AND area = $2 AND comp_idx = $3',
      [ordenId, area, compIdx, nuevo],
    );

    // ── Bitácora (con ventana de fusión) ───────────────────────────────────
    const { rows: ult } = await query<{ id: string; delta: number }>(
      `SELECT id, delta FROM reportes
        WHERE orden_id = $1 AND area = $2 AND comp_idx = $3 AND usuario_email = $4
          AND creado_en > NOW() - ($5 || ' minutes')::interval
        ORDER BY creado_en DESC
        LIMIT 1`,
      [ordenId, area, compIdx, usuario.email, VENTANA_FUSION_MIN],
    );

    const delta = nuevo - previo;
    if (ult.length > 0) {
      await query(
        'UPDATE reportes SET hecho = $2, delta = delta + $3 WHERE id = $1',
        [ult[0].id, nuevo, delta],
      );
    } else {
      await query(
        `INSERT INTO reportes (orden_id, area, comp_idx, nombre, hecho, delta, usuario_email, usuario_nombre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ordenId, area, compIdx, comp.nombre, nuevo, delta, usuario.email, usuario.nombre],
      );
    }

    // Si con esta captura TODAS las áreas quedaron al 100 %, la orden se cierra
    // sola (sin necesidad de un admin conectado).
    cierre = await cerrarOrdenSiCompleta(ordenId);
  }

  return NextResponse.json({ hecho: nuevo, ...cierre });
}
