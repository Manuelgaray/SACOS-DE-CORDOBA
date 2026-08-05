// ─────────────────────────────────────────────────────────────────────────────
//  Migraciones idempotentes de esquema (columnas que se agregaron después).
//
//  Uso:   node scripts/migrate.mjs
//  Lee DATABASE_URL de .env.local. Solo agrega columnas con IF NOT EXISTS, así
//  que es seguro volver a correrlo (no borra ni modifica datos existentes).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

// Lista de migraciones aditivas (idempotentes).
const MIGRACIONES = [
  // Una sola sesión activa por usuario: token de la sesión vigente.
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_token TEXT`,
  // Heartbeat de la sesión: última señal de vida (para liberar sesiones muertas).
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_last_seen TIMESTAMPTZ`,
  // Explosión de materiales del área de corte (por si la base es vieja).
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS corte_elementos JSONB`,
  // Firmas reales: quién elaboró la orden y qué admin la autorizó.
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS elaborado_por TEXT`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS autorizado_por TEXT`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_autorizacion TIMESTAMPTZ`,
  // Calendario: cuándo terminó la orden.
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMPTZ`,
  // Bitácora de reportes de avance (quién/cuándo/cuánto por componente).
  `CREATE TABLE IF NOT EXISTS reportes (
     id             BIGSERIAL PRIMARY KEY,
     orden_id       TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     area           TEXT NOT NULL,
     comp_idx       INTEGER NOT NULL,
     nombre         TEXT NOT NULL,
     hecho          INTEGER NOT NULL,
     delta          INTEGER NOT NULL,
     usuario_email  TEXT,
     usuario_nombre TEXT,
     creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS reportes_orden ON reportes (orden_id, area, creado_en)`,
  `CREATE INDEX IF NOT EXISTS reportes_fecha ON reportes (creado_en)`,
  // Hoja de corte (verificación de material): un renglón por corrida de corte.
  `CREATE TABLE IF NOT EXISTS hoja_corte (
     id            BIGSERIAL PRIMARY KEY,
     orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
     operador      TEXT NOT NULL DEFAULT '',
     maquina       TEXT NOT NULL DEFAULT '',
     hora          TEXT NOT NULL DEFAULT '',
     rollo         TEXT NOT NULL DEFAULT '',
     elemento      TEXT NOT NULL DEFAULT '',
     medida_spec   TEXT NOT NULL DEFAULT '',
     medida_real   TEXT NOT NULL DEFAULT '',
     material_spec TEXT NOT NULL DEFAULT '',
     material_real TEXT NOT NULL DEFAULT '',
     laminado      BOOLEAN NOT NULL DEFAULT false,
     diam_spec     TEXT NOT NULL DEFAULT '',
     diam_real     TEXT NOT NULL DEFAULT '',
     piezas        INTEGER NOT NULL DEFAULT 0,
     firma         TEXT NOT NULL DEFAULT '',
     pc            BOOLEAN NOT NULL DEFAULT false,
     capturado_por TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_corte_orden ON hoja_corte (orden_id, fecha, id)`,
  // Hoja de control de material (compartida por Small y Tips): matriz de
  // material (renglones libres) × fechas (columnas) con piezas entregadas.
  `CREATE TABLE IF NOT EXISTS hoja_material (
     id          BIGSERIAL PRIMARY KEY,
     orden_id    TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     descripcion TEXT NOT NULL DEFAULT '',
     entregas    JSONB NOT NULL DEFAULT '{}'::jsonb,
     creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_material_orden ON hoja_material (orden_id, id)`,
  // Check por operación: el supervisor marca que ese material ya se terminó
  // (se alcanzó la meta), sin depender de la cuenta de piezas.
  `ALTER TABLE hoja_material ADD COLUMN IF NOT EXISTS terminado BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS hoja_material_fecha (
     orden_id TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha    DATE NOT NULL,
     entrega  TEXT NOT NULL DEFAULT '',
     recibe   TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (orden_id, fecha)
   )`,
  // Hoja de reporte de producción de Raw Bag y Tapa (compartida por Big y Tapa):
  // un renglón por operador/máquina con su producción en bloques de 2 horas.
  `CREATE TABLE IF NOT EXISTS hoja_rawbag (
     id            BIGSERIAL PRIMARY KEY,
     orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
     maquina       TEXT NOT NULL DEFAULT '',
     operador      TEXT NOT NULL DEFAULT '',
     actividad     TEXT NOT NULL DEFAULT '',
     p08           INTEGER NOT NULL DEFAULT 0,
     p10           INTEGER NOT NULL DEFAULT 0,
     p12           INTEGER NOT NULL DEFAULT 0,
     p14           INTEGER NOT NULL DEFAULT 0,
     observaciones TEXT NOT NULL DEFAULT '',
     terminado     BOOLEAN NOT NULL DEFAULT false,
     capturado_por TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_rawbag_orden ON hoja_rawbag (orden_id, fecha, id)`,
  // Check POR ACTIVIDAD de la hoja de Raw Bag (no por renglón): así el avance no
  // depende de cuántas hojas/días se llenen, solo de las actividades de la orden.
  `CREATE TABLE IF NOT EXISTS hoja_rawbag_actividad (
     orden_id  TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     actividad TEXT NOT NULL,
     terminado BOOLEAN NOT NULL DEFAULT false,
     PRIMARY KEY (orden_id, actividad)
   )`,
  // Verificación de área de Raw Bag (solo Big): control de calidad por operador
  // — medidas, loops, diámetro y material, especificación contra lo real.
  `CREATE TABLE IF NOT EXISTS hoja_verif_rawbag (
     id             BIGSERIAL PRIMARY KEY,
     orden_id       TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
     operador       TEXT NOT NULL DEFAULT '',
     hora           TEXT NOT NULL DEFAULT '',
     puntadas       TEXT NOT NULL DEFAULT '',
     hilos          TEXT NOT NULL DEFAULT '',
     medida_spec    TEXT NOT NULL DEFAULT '',
     medida_real    TEXT NOT NULL DEFAULT '',
     loop_libre_spec     TEXT NOT NULL DEFAULT '',
     loop_traslape_spec  TEXT NOT NULL DEFAULT '',
     loop_costurado_spec TEXT NOT NULL DEFAULT '',
     loop_color_spec     TEXT NOT NULL DEFAULT '',
     loop_libre_real     TEXT NOT NULL DEFAULT '',
     loop_traslape_real  TEXT NOT NULL DEFAULT '',
     loop_costurado_real TEXT NOT NULL DEFAULT '',
     loop_color_real     TEXT NOT NULL DEFAULT '',
     diam_spec      TEXT NOT NULL DEFAULT '',
     diam_real      TEXT NOT NULL DEFAULT '',
     material_spec  TEXT NOT NULL DEFAULT '',
     material_real  TEXT NOT NULL DEFAULT '',
     filler1        BOOLEAN NOT NULL DEFAULT false,
     filler2        BOOLEAN NOT NULL DEFAULT false,
     folt           BOOLEAN NOT NULL DEFAULT false,
     pc             BOOLEAN NOT NULL DEFAULT false,
     observaciones  TEXT NOT NULL DEFAULT '',
     capturado_por  TEXT,
     creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_verif_rawbag_orden ON hoja_verif_rawbag (orden_id, fecha, id)`,
  // CONTROL DE MESAS DE CALIDAD: una fila por HOJA física (día + turno). Cada
  // hoja trae 4 mesas de 2 personas y el conteo de sacos revisados por mesa (la
  // retícula de 1 a 175 del papel). El avance del área es la suma de todas las
  // mesas de todas las hojas contra los sacos de la orden.
  `CREATE TABLE IF NOT EXISTS hoja_calidad (
     id            BIGSERIAL PRIMARY KEY,
     orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
     turno         TEXT NOT NULL DEFAULT '',
     supervisor    TEXT NOT NULL DEFAULT '',
     observaciones TEXT NOT NULL DEFAULT '',
     m1_nombres    TEXT NOT NULL DEFAULT '',
     m1_total      INTEGER NOT NULL DEFAULT 0,
     m2_nombres    TEXT NOT NULL DEFAULT '',
     m2_total      INTEGER NOT NULL DEFAULT 0,
     m3_nombres    TEXT NOT NULL DEFAULT '',
     m3_total      INTEGER NOT NULL DEFAULT 0,
     m4_nombres    TEXT NOT NULL DEFAULT '',
     m4_total      INTEGER NOT NULL DEFAULT 0,
     capturado_por TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_calidad_orden ON hoja_calidad (orden_id, fecha, id)`,
  // FORMATO DE DEFECTOS Y HALLAZGOS EN PROCESO (Calidad): un renglón por saco
  // con hallazgo — mesa, etiqueta, máquina, operador, tipo de defecto y si se
  // aprobó o se rechazó. Es solo registro: no afecta el avance del área.
  `CREATE TABLE IF NOT EXISTS hoja_defectos (
     id            BIGSERIAL PRIMARY KEY,
     orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
     turno         TEXT NOT NULL DEFAULT '',
     mesa          TEXT NOT NULL DEFAULT '',
     etiqueta      TEXT NOT NULL DEFAULT '',
     maquina       TEXT NOT NULL DEFAULT '',
     operador      TEXT NOT NULL DEFAULT '',
     defecto       TEXT NOT NULL DEFAULT '',
     resultado     TEXT NOT NULL DEFAULT '',
     capturado_por TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_defectos_orden ON hoja_defectos (orden_id, fecha, id)`,
  // El spec deja de ser solo un nombre: es el DISEÑO del saco. Guarda sus
  // especificaciones, su explosión de materiales y el PDF del diseño, para que
  // al crear una orden ya venga todo adelantado.
  `ALTER TABLE specs
     ADD COLUMN IF NOT EXISTS medida          TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS carga_lbs       INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS tipo_saco       TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS grado           TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS corte_elementos JSONB,
     ADD COLUMN IF NOT EXISTS pdf_data        BYTEA,
     ADD COLUMN IF NOT EXISTS pdf_nombre      TEXT,
     ADD COLUMN IF NOT EXISTS pdf_mime        TEXT DEFAULT 'application/pdf',
     ADD COLUMN IF NOT EXISTS registrado_por  TEXT,
     ADD COLUMN IF NOT EXISTS actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()`,
  // Precarga: los specs que ya tienen órdenes heredan las especificaciones y la
  // explosión de su última orden, para no capturarlas de nuevo a mano.
  `UPDATE specs s SET
     medida          = COALESCE(NULLIF(s.medida, ''), o.medida),
     carga_lbs       = CASE WHEN s.carga_lbs = 0 THEN o.carga_lbs ELSE s.carga_lbs END,
     tipo_saco       = COALESCE(NULLIF(s.tipo_saco, ''), o.tipo_saco),
     grado           = COALESCE(NULLIF(s.grado, ''), COALESCE(o.grado, '')),
     corte_elementos = COALESCE(s.corte_elementos, o.corte_elementos)
   FROM (
     SELECT DISTINCT ON (UPPER(TRIM(spec))) UPPER(TRIM(spec)) AS spec,
            medida, carga_lbs, tipo_saco, grado, corte_elementos
       FROM ordenes
      WHERE TRIM(COALESCE(spec, '')) <> ''
      ORDER BY UPPER(TRIM(spec)), fecha_creacion DESC
   ) o
   WHERE UPPER(s.spec) = o.spec
     AND (s.tipo_saco = '' OR s.medida = '' OR s.corte_elementos IS NULL)`,
  // El plano del diseño también se hereda: los specs sin PDF toman el de su
  // última orden que tenga uno. Solo rellena los vacíos (es idempotente).
  `UPDATE specs s SET
     pdf_data   = o.pdf_data,
     pdf_nombre = o.pdf_nombre,
     pdf_mime   = COALESCE(o.pdf_mime, 'application/pdf')
   FROM (
     SELECT DISTINCT ON (UPPER(TRIM(spec))) UPPER(TRIM(spec)) AS spec,
            pdf_data, pdf_nombre, pdf_mime
       FROM ordenes
      WHERE TRIM(COALESCE(spec, '')) <> '' AND pdf_data IS NOT NULL
      ORDER BY UPPER(TRIM(spec)), fecha_creacion DESC
   ) o
   WHERE UPPER(s.spec) = o.spec AND s.pdf_data IS NULL`,
  // FORMATO DE SALIDA Y ENTREGA DE MATERIALES A PRODUCCIÓN (Almacén).
  // Una fila por ENTREGA (la hoja) y una fila por renglón de material.
  // El avance del área son los sacos cuyo material ya salió a producción.
  `CREATE TABLE IF NOT EXISTS hoja_almacen (
     id                   BIGSERIAL PRIMARY KEY,
     orden_id             TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     fecha                DATE NOT NULL DEFAULT CURRENT_DATE,
     cantidad_entregada   INTEGER NOT NULL DEFAULT 0,
     firma_entrega        TEXT NOT NULL DEFAULT '',
     firma_recepcion_corte TEXT NOT NULL DEFAULT '',
     firma_recepcion_prod TEXT NOT NULL DEFAULT '',
     firma_recepcion_alm  TEXT NOT NULL DEFAULT '',
     firma_entrega_corte  TEXT NOT NULL DEFAULT '',
     capturado_por        TEXT,
     creado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_almacen_orden ON hoja_almacen (orden_id, fecha, id)`,
  // Renglones de material. `resumen` marca las filas sombreadas del papel: el
  // total por familia de material, sin etiqueta ni factura.
  `CREATE TABLE IF NOT EXISTS hoja_almacen_material (
     id                 BIGSERIAL PRIMARY KEY,
     hoja_id            BIGINT NOT NULL REFERENCES hoja_almacen(id) ON DELETE CASCADE,
     resumen            BOOLEAN NOT NULL DEFAULT false,
     material           TEXT NOT NULL DEFAULT '',
     etiqueta           TEXT NOT NULL DEFAULT '',
     factura            TEXT NOT NULL DEFAULT '',
     tag                TEXT NOT NULL DEFAULT '',
     cantidad           NUMERIC(12,2) NOT NULL DEFAULT 0,
     unidad             TEXT NOT NULL DEFAULT '',
     consumo_esperado   NUMERIC(12,2) NOT NULL DEFAULT 0,
     devolucion_real    NUMERIC(12,2) NOT NULL DEFAULT 0,
     creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_almacen_material_hoja ON hoja_almacen_material (hoja_id, id)`,
  // Los renglones sombreados dejaron de capturarse: la familia se deduce del
  // código del rollo (SCFLF6CW48RAF → 6CW48) y su cantidad es la suma de sus
  // rollos. En el renglón de cada rollo ya no va consumo ni devolución.
  `ALTER TABLE hoja_almacen_material
     DROP COLUMN IF EXISTS resumen,
     DROP COLUMN IF EXISTS consumo_esperado,
     DROP COLUMN IF EXISTS devolucion_real`,
  // Consumo y devolución viven POR FAMILIA, que es donde los anota el papel.
  `CREATE TABLE IF NOT EXISTS hoja_almacen_consumo (
     hoja_id          BIGINT NOT NULL REFERENCES hoja_almacen(id) ON DELETE CASCADE,
     familia          TEXT NOT NULL,
     consumo_esperado NUMERIC(12,2) NOT NULL DEFAULT 0,
     devolucion_real  NUMERIC(12,2) NOT NULL DEFAULT 0,
     PRIMARY KEY (hoja_id, familia)
   )`,
  // Almacén dejó de reportar material por material (rollos, discos, bobinas) y
  // ahora se mide por sacos surtidos. Sus filas de avance viejas se reemplazan
  // por el punto único del formato nuevo; si no, quedarían renglones que nunca
  // se completan y bloquearían el cierre automático de la orden.
  `DELETE FROM avances
    WHERE area = 'almacen' AND nombre <> 'Material entregado a producción'`,
  `INSERT INTO avances (orden_id, area, comp_idx, nombre, meta, hecho)
     SELECT o.id, 'almacen', 0, 'Material entregado a producción',
            GREATEST(1, o.cantidad),
            -- Las órdenes ya cerradas conservan su 100 %: su material salió.
            CASE WHEN o.status = 'terminada' THEN GREATEST(1, o.cantidad) ELSE 0 END
       FROM ordenes o
   ON CONFLICT (orden_id, area, comp_idx) DO NOTHING`,
  // CONTROL DE TARIMAS Y SACOS EN PRENSA (Empaque): una fila por TARIMA, con su
  // fecha, número, el conteo de sacos prensados (retícula de 1 a 200 del papel)
  // y el peso en libras. El avance del área es la suma de todas las tarimas.
  `CREATE TABLE IF NOT EXISTS hoja_empaque (
     id            BIGSERIAL PRIMARY KEY,
     orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     numero        INTEGER NOT NULL DEFAULT 1,
     fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
     turno         TEXT NOT NULL DEFAULT '',
     contados      INTEGER NOT NULL DEFAULT 0,
     peso          INTEGER NOT NULL DEFAULT 0,
     capturado_por TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS hoja_empaque_orden ON hoja_empaque (orden_id, numero, id)`,
  // Regla de las mesas de calidad: cada mesa la trabajan DOS personas. Se
  // guardan por separado para poder exigirlas, y la mesa solo suma cuando está
  // activada (el check solo se puede marcar con los dos operadores puestos).
  `ALTER TABLE hoja_calidad
     ADD COLUMN IF NOT EXISTS m1_op1 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m1_op2 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m1_activa BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS m2_op1 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m2_op2 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m2_activa BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS m3_op1 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m3_op2 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m3_activa BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS m4_op1 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m4_op2 TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS m4_activa BOOLEAN NOT NULL DEFAULT false`,
  // El campo libre de nombres queda sustituido por los dos operadores.
  `ALTER TABLE hoja_calidad
     DROP COLUMN IF EXISTS m1_nombres,
     DROP COLUMN IF EXISTS m2_nombres,
     DROP COLUMN IF EXISTS m3_nombres,
     DROP COLUMN IF EXISTS m4_nombres`,
  // Registro maestro de clientes y sus productos (specs únicos e irrepetibles).
  `CREATE TABLE IF NOT EXISTS clientes (
     nombre TEXT PRIMARY KEY
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clientes_nombre_lower ON clientes (LOWER(nombre))`,
  `CREATE TABLE IF NOT EXISTS specs (
     spec    TEXT PRIMARY KEY,
     cliente TEXT NOT NULL REFERENCES clientes(nombre) ON UPDATE CASCADE ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS specs_spec_upper ON specs (UPPER(spec))`,
  `CREATE INDEX IF NOT EXISTS specs_cliente ON specs (cliente)`,
  // Los PDFs salen de la base y se van a Supabase Storage: aquí queda solo la
  // ruta dentro del bucket. `pdf_data` se conserva por ahora para no perder
  // nada mientras se migran los archivos existentes.
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS pdf_path TEXT`,
  `ALTER TABLE specs   ADD COLUMN IF NOT EXISTS pdf_path TEXT`,
  // Índices del listado paginado: ordena por fecha y filtra por estado. Con
  // pocas órdenes da igual, pero el histórico de la planta crece cada día.
  `CREATE INDEX IF NOT EXISTS ordenes_fecha_creacion ON ordenes (fecha_creacion DESC)`,
  `CREATE INDEX IF NOT EXISTS ordenes_status ON ordenes (status)`,
  `CREATE INDEX IF NOT EXISTS avances_orden ON avances (orden_id)`,
  // Precarga: puebla el registro con los clientes/specs de las órdenes existentes.
  `INSERT INTO clientes (nombre)
     SELECT DISTINCT TRIM(cliente) FROM ordenes
      WHERE TRIM(COALESCE(cliente, '')) <> ''
   ON CONFLICT DO NOTHING`,
  `INSERT INTO specs (spec, cliente)
     SELECT DISTINCT ON (UPPER(TRIM(o.spec))) UPPER(TRIM(o.spec)), c.nombre
       FROM ordenes o
       JOIN clientes c ON LOWER(c.nombre) = LOWER(TRIM(o.cliente))
      WHERE TRIM(COALESCE(o.spec, '')) <> ''
   ON CONFLICT DO NOTHING`,
];

// ── Cargar DATABASE_URL desde .env.local ───────────────────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env.local");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]])
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .env.local: confiamos en variables de entorno del sistema */
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("✗ Falta DATABASE_URL (ponlo en .env.local).");
  process.exit(1);
}

// Fuera de la red local (Supabase, servidor remoto) la conexión va cifrada.
const remota = !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: remota ? { rejectUnauthorized: false } : undefined,
  max: 1,
  connectionTimeoutMillis: 15000,
});

try {
  // En una base NUEVA (Supabase recién creado, otra PC) primero hay que crear
  // el esquema base; las migraciones de abajo solo agregan lo que vino después.
  // schema.sql es idempotente, así que correrlo siempre es seguro.
  const { rows } = await pool.query(
    "SELECT to_regclass('public.usuarios') IS NOT NULL AS existe",
  );
  if (!rows[0].existe) {
    console.log("Base nueva: creando el esquema desde db/schema.sql…");
    const esquema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql"), "utf8");
    await pool.query(esquema);
    console.log("✓ Esquema base creado.\n");
  }

  for (const sql of MIGRACIONES) {
    await pool.query(sql);
    console.log(`✓ ${sql}`);
  }
  console.log(`\nListo: ${MIGRACIONES.length} migraciones aplicadas.`);
} catch (e) {
  console.error("✗ Error aplicando migraciones:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
