import { NextResponse } from 'next/server';
import { query } from '@/compartido/db';
import { emailDeSesion } from '@/autenticacion/supabase-servidor';
import { rowToOrden, ORDEN_COLS, type OrdenRow } from '@/ordenes/orden-map';
import { generarAvance } from '@/produccion/produccion';
import { normalizarElementos } from '@/explosion-materiales/explosion';
import { moverObjeto, copiarObjeto, rutaOrden, rutaSpec } from '@/compartido/storage';

export const runtime = 'nodejs';

// POST /api/ordenes — crea una orden (carátula + PDF embebido) y genera sus avances.
// Autorización: la sesión de Supabase identifica al usuario; solo admin/diseño suben.
export async function POST(req: Request) {
  // La identidad viene de la sesión de Supabase, no de un encabezado.
  const actorEmail = await emailDeSesion();
  if (!actorEmail) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { rows: urows } = await query<{ nombre: string; rol: string }>(
    'SELECT nombre, rol FROM usuarios WHERE email = $1',
    [actorEmail],
  );
  const rol = urows[0]?.rol;
  if (rol !== 'admin' && rol !== 'diseno') {
    return NextResponse.json({ error: 'No tienes permiso para subir órdenes' }, { status: 403 });
  }
  // Firma real: quién elabora la orden (usuario logueado que la crea).
  const elaboradoPor = urows[0]?.nombre ?? actorEmail;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  // ── El plano ───────────────────────────────────────────────────────────────
  // El navegador ya lo subió a Storage (ruta temporal) o pide heredar el del
  // spec. En ninguno de los dos casos el archivo pasa por aquí.
  const pdfTemporal = String(body.pdf_path ?? '').trim();
  const pdfCopiarDe = String(body.pdf_copiar_de ?? '').trim();
  if (!pdfTemporal && !pdfCopiarDe) {
    return NextResponse.json({ error: 'Falta el PDF de la orden' }, { status: 400 });
  }
  // Las rutas vienen de nuestro propio endpoint de subida; se validan igual.
  if (pdfTemporal && !pdfTemporal.startsWith('temp/')) {
    return NextResponse.json({ error: 'Ruta de archivo no válida' }, { status: 400 });
  }
  if (pdfCopiarDe && !/^(specs|ordenes)\//.test(pdfCopiarDe)) {
    return NextResponse.json({ error: 'Ruta de archivo no válida' }, { status: 400 });
  }

  const str = (k: string) => String(body[k] ?? '').trim();
  const num = (k: string) => parseInt(String(body[k] ?? ''), 10) || 0;

  if (!str('numero_orden') || !str('cliente') || !str('spec') || !str('medida')) {
    return NextResponse.json({ error: 'Faltan datos de la carátula' }, { status: 400 });
  }

  // ── Registro maestro de clientes/specs ─────────────────────────────────────
  // El spec es único e irrepetible: si ya pertenece a OTRO cliente, la orden se
  // rechaza. Cliente y spec nuevos se registran solos al crear la orden.
  const clienteCap = str('cliente');
  const specCap = str('spec').toUpperCase();

  const { rows: specRows } = await query<{ spec: string; cliente: string }>(
    'SELECT spec, cliente FROM specs WHERE UPPER(spec) = $1',
    [specCap],
  );
  const specExistente = specRows[0];
  if (specExistente && specExistente.cliente.toLowerCase() !== clienteCap.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          `El spec ${specExistente.spec} ya está registrado para el cliente ` +
          `${specExistente.cliente}. Cada spec es único e irrepetible; revisa el dato.`,
      },
      { status: 409 },
    );
  }

  // Alta automática en el registro (idempotente).
  await query('INSERT INTO clientes (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [clienteCap]);
  if (!specExistente) {
    // Usa el nombre canónico del registro (por si difiere en mayúsculas).
    const { rows: cRows } = await query<{ nombre: string }>(
      'SELECT nombre FROM clientes WHERE LOWER(nombre) = LOWER($1)',
      [clienteCap],
    );
    const clienteCanonico = cRows[0]?.nombre ?? clienteCap;
    await query('INSERT INTO specs (spec, cliente) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      specCap,
      clienteCanonico,
    ]);
  }

  const id = `ord-${Date.now()}`;
  const ahora = new Date().toISOString();
  const status = body.status === 'programada' ? 'programada' : 'activa';
  const fechaInicio = status === 'activa' ? ahora : null;
  const linea = num('linea') === 2 ? 2 : 1;

  // Explosión de materiales capturada en "Nueva orden" (opcional). Si viene vacía
  // o sin medidas útiles, guardamos null para no ensuciar la orden.
  const elementos = normalizarElementos(body.corte_elementos);
  const corteJson = elementos.length > 0 ? JSON.stringify(elementos) : null;

  // ── El plano queda en su lugar definitivo ──────────────────────────────────
  // Subida nueva: se mueve de temp/ a ordenes/<id>.pdf. Heredado del spec: se
  // copia, para que cada orden tenga su propio archivo y borrar un diseño no
  // deje órdenes sin plano.
  const rutaFinal = rutaOrden(id);
  const colocado = pdfTemporal
    ? await moverObjeto(pdfTemporal, rutaFinal)
    : await copiarObjeto(pdfCopiarDe, rutaFinal);
  if (!colocado) {
    return NextResponse.json(
      { error: 'No se pudo guardar el PDF en el almacenamiento. Vuelve a intentarlo.' },
      { status: 502 },
    );
  }

  // ── El diseño del spec se completa solo ────────────────────────────────────
  // Si el spec ya tenía diseño registrado en Clientes, no se toca: ese es la
  // fuente de la verdad. Pero si le faltaba algo (specs viejos, o dados de alta
  // desde aquí), esta orden lo llena, y la siguiente ya lo hereda.
  const { rows: specSinPlano } = await query<{ falta: boolean }>(
    'SELECT (pdf_path IS NULL AND pdf_data IS NULL) AS falta FROM specs WHERE UPPER(spec) = $1',
    [specCap],
  );
  // El spec se queda con su propia copia del plano.
  let rutaSpecPdf: string | null = null;
  if (specSinPlano[0]?.falta) {
    const destino = rutaSpec(specCap);
    if (await copiarObjeto(rutaFinal, destino)) rutaSpecPdf = destino;
  }

  await query(
    `UPDATE specs SET
       medida          = CASE WHEN medida    = ''   THEN $2 ELSE medida    END,
       carga_lbs       = CASE WHEN carga_lbs = 0    THEN $3 ELSE carga_lbs END,
       tipo_saco       = CASE WHEN tipo_saco = ''   THEN $4 ELSE tipo_saco END,
       grado           = CASE WHEN grado     = ''   THEN $5 ELSE grado     END,
       corte_elementos = COALESCE(corte_elementos, $6::jsonb),
       pdf_path        = COALESCE(pdf_path, $7),
       pdf_nombre      = COALESCE(pdf_nombre, $8),
       registrado_por  = COALESCE(registrado_por, $9),
       actualizado_en  = now()
     WHERE UPPER(spec) = $1`,
    [
      specCap,
      str('medida'),
      num('carga_lbs'),
      str('tipo_saco'),
      str('grado'),
      corteJson,
      rutaSpecPdf,
      String(body.pdf_nombre ?? '').trim() || null,
      elaboradoPor,
    ],
  );

  const { rows } = await query<OrdenRow>(
    `INSERT INTO ordenes (
       id, numero_orden, cliente, spec, medida, cantidad, carga_lbs, tipo_saco,
       orden_cliente, embarcar_a, grado, area_actual, status, linea,
       fecha_creacion, fecha_inicio, fecha_entrega, pdf_path, pdf_nombre, corte_elementos,
       elaborado_por
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20::jsonb,
       $21
     )
     RETURNING ${ORDEN_COLS}`,
    [
      id,
      str('numero_orden'),
      str('cliente'),
      str('spec'),
      str('medida'),
      num('cantidad'),
      num('carga_lbs'),
      str('tipo_saco') || 'U-PANEL',
      str('orden_cliente') || null,
      str('embarcar_a') || null,
      (body.grado as string) || null,
      null, // area_actual: la orden arranca sin frente de trabajo
      status,
      linea,
      ahora,
      fechaInicio,
      (body.fecha_entrega as string) || null,
      rutaFinal,
      str('pdf_nombre') || 'orden.pdf',
      corteJson,
      elaboradoPor,
    ],
  );

  const orden = rowToOrden(rows[0]);

  // Generar e insertar los avances de la nueva orden.
  const avances = generarAvance(orden);
  for (const av of avances) {
    for (let i = 0; i < av.componentes.length; i++) {
      const c = av.componentes[i];
      await query(
        `INSERT INTO avances (orden_id, area, comp_idx, nombre, meta, hecho)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orden.id, av.area, i, c.nombre, c.meta, c.hecho],
      );
    }
  }

  return NextResponse.json({ orden, avances });
}
