-- Active: 1749217360563@@127.0.0.1@5432@supersacos
-- ─────────────────────────────────────────────────────────────────────────────
--  SuperSacos Pro — Esquema de la base de datos (PostgreSQL)
--
--  Ejecutar contra la base de datos `supersacos`:
--    psql -U supersacos_app -d supersacos -f db/schema.sql
--
--  Es idempotente (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING):
--  se puede volver a correr sin borrar datos.
--
--  Las contraseñas de los usuarios NO se siembran aquí (requieren hash bcrypt);
--  para eso usa  node scripts/seed-users.mjs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Usuarios del sistema ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  email          TEXT PRIMARY KEY,
  password_hash  TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  rol            TEXT NOT NULL CHECK (rol IN ('admin', 'diseno', 'supervisor')),
  area_asignada  TEXT,
  -- Sesión única por usuario ("el primero gana"): token de la sesión vigente y
  -- última señal de vida (heartbeat). El login se rechaza si hay una sesión con
  -- last_seen reciente en otro dispositivo; al cerrar sesión ambos se limpian.
  session_token     TEXT,
  session_last_seen TIMESTAMPTZ
);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_last_seen TIMESTAMPTZ;

-- ─── Registro maestro de clientes y sus productos (specs) ──────────────────────
-- Cada cliente tiene 1..N sacos que le desarrollamos; cada saco se identifica
-- por su spec, que es ÚNICO E IRREPETIBLE en todo el sistema.
CREATE TABLE IF NOT EXISTS clientes (
  nombre  TEXT PRIMARY KEY
);
-- Unicidad sin distinguir mayúsculas/acentos de dedo ("BULK LIFT" vs "Bulk Lift").
CREATE UNIQUE INDEX IF NOT EXISTS clientes_nombre_lower ON clientes (LOWER(nombre));

-- Un spec no es solo un nombre: es el DISEÑO del saco. Guarda sus
-- especificaciones, su explosión de materiales y el PDF del diseño, para que al
-- crear una orden ya venga todo adelantado.
CREATE TABLE IF NOT EXISTS specs (
  spec            TEXT PRIMARY KEY,
  cliente         TEXT NOT NULL REFERENCES clientes(nombre) ON UPDATE CASCADE ON DELETE CASCADE,
  medida          TEXT NOT NULL DEFAULT '',
  carga_lbs       INTEGER NOT NULL DEFAULT 0,
  tipo_saco       TEXT NOT NULL DEFAULT '',
  grado           TEXT NOT NULL DEFAULT '',
  corte_elementos JSONB,
  pdf_data        BYTEA,
  pdf_nombre      TEXT,
  pdf_mime        TEXT DEFAULT 'application/pdf',
  registrado_por  TEXT,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS specs_spec_upper ON specs (UPPER(spec));
CREATE INDEX IF NOT EXISTS specs_cliente ON specs (cliente);

-- ─── Órdenes de producción (carátula + PDF embebido) ────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes (
  id             TEXT PRIMARY KEY,
  numero_orden   TEXT NOT NULL,
  cliente        TEXT NOT NULL,
  spec           TEXT NOT NULL,
  medida         TEXT NOT NULL,
  cantidad       INTEGER NOT NULL,
  carga_lbs      INTEGER NOT NULL,
  tipo_saco      TEXT NOT NULL,
  orden_cliente  TEXT,
  embarcar_a     TEXT,
  grado          TEXT,
  area_actual    TEXT,
  status         TEXT NOT NULL DEFAULT 'activa'
                   CHECK (status IN ('activa', 'programada', 'pausada', 'terminada', 'cancelada')),
  linea          SMALLINT,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_inicio   TIMESTAMPTZ,
  fecha_entrega  DATE,
  -- El diseño y las especificaciones técnicas viven en el PDF subido.
  pdf_data       BYTEA,
  pdf_nombre     TEXT,
  pdf_mime       TEXT DEFAULT 'application/pdf',
  -- Elementos de corte para la explosión de materiales (explosion-materiales/).
  corte_elementos JSONB,
  -- Firmas reales: quién creó la orden y qué admin la autorizó.
  elaborado_por      TEXT,
  autorizado_por     TEXT,
  fecha_autorizacion TIMESTAMPTZ
);

-- Para bases ya creadas antes de estas columnas (idempotente).
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS corte_elementos JSONB;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS elaborado_por TEXT;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS autorizado_por TEXT;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_autorizacion TIMESTAMPTZ;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMPTZ;

-- ─── Bitácora de reportes de avance ─────────────────────────────────────────────
-- Cada renglón es UN reporte de un supervisor: quién, cuándo, en qué orden/área/
-- componente, el acumulado reportado y el delta contra el reporte anterior.
-- Alimenta el calendario de producción y el monitoreo de rendimiento.
CREATE TABLE IF NOT EXISTS reportes (
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
);
CREATE INDEX IF NOT EXISTS reportes_orden ON reportes (orden_id, area, creado_en);
CREATE INDEX IF NOT EXISTS reportes_fecha ON reportes (creado_en);

-- ─── Hoja de corte (verificación de material) ──────────────────────────────────
-- Réplica digital de la hoja física del área de corte: un renglón por corrida
-- (operador, máquina, hora, rollo, elemento, medidas/material/diámetro espec y
-- real, laminado, piezas cortadas, firma y verificación de contaminación).
-- Los totales por elemento alimentan el avance de Corte y la bitácora.
CREATE TABLE IF NOT EXISTS hoja_corte (
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
);
CREATE INDEX IF NOT EXISTS hoja_corte_orden ON hoja_corte (orden_id, fecha, id);

-- ─── Hoja de control de material (Small + Tips, compartida) ────────────────────
-- Réplica de la hoja física: cada renglón es un material que el supervisor
-- describe libremente y `entregas` guarda las piezas por fecha
-- ({"2026-07-07": 350, ...}). Las columnas de fecha y sus firmas viven en
-- hoja_material_fecha. Los totales alimentan el avance de Small y Tips.
CREATE TABLE IF NOT EXISTS hoja_material (
  id          BIGSERIAL PRIMARY KEY,
  orden_id    TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL DEFAULT '',
  entregas    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- El supervisor marca la operación como terminada (meta alcanzada).
  terminado   BOOLEAN NOT NULL DEFAULT false,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE hoja_material ADD COLUMN IF NOT EXISTS terminado BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS hoja_material_orden ON hoja_material (orden_id, id);

CREATE TABLE IF NOT EXISTS hoja_material_fecha (
  orden_id TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  fecha    DATE NOT NULL,
  entrega  TEXT NOT NULL DEFAULT '',
  recibe   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (orden_id, fecha)
);

-- ─── Hoja de producción de Raw Bag y Tapa (Big + Tapa, compartida) ─────────────
-- Réplica de la hoja física: un renglón por operador/máquina con la actividad
-- realizada y su producción en bloques de 2 horas (08, 10, 12, 14). El avance de
-- estas áreas se mide por operaciones terminadas (columna `terminado`).
CREATE TABLE IF NOT EXISTS hoja_rawbag (
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
);
CREATE INDEX IF NOT EXISTS hoja_rawbag_orden ON hoja_rawbag (orden_id, fecha, id);

-- Check por ACTIVIDAD de la hoja de Raw Bag: el avance de Big y Tapa se mide por
-- actividades terminadas (BASE, UNIÓN, TAPA…), sumando todos los días y
-- operarios; así el número de hojas no altera el cálculo.
CREATE TABLE IF NOT EXISTS hoja_rawbag_actividad (
  orden_id  TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  actividad TEXT NOT NULL,
  terminado BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (orden_id, actividad)
);

-- ─── Verificación de área de Raw Bag (solo Big) ────────────────────────────────
-- Control de calidad por operador (2 revisiones por turno): medidas del saco,
-- loops, diámetro V.D y material, comparando especificación contra lo real.
-- Es solo registro: no afecta el avance del área.
CREATE TABLE IF NOT EXISTS hoja_verif_rawbag (
  id       BIGSERIAL PRIMARY KEY,
  orden_id    TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  fecha    DATE NOT NULL DEFAULT CURRENT_DATE,
  operador    TEXT NOT NULL DEFAULT '',
  hora     TEXT NOT NULL DEFAULT '',
  puntadas    TEXT NOT NULL DEFAULT '',
  hilos    TEXT NOT NULL DEFAULT '',
  medida_spec    TEXT NOT NULL DEFAULT '',
  medida_real    TEXT NOT NULL DEFAULT '',
  loop_libre_spec  TEXT NOT NULL DEFAULT '',
  loop_traslape_spec  TEXT NOT NULL DEFAULT '',
  loop_costurado_spec TEXT NOT NULL DEFAULT '',
  loop_color_spec  TEXT NOT NULL DEFAULT '',
  loop_libre_real  TEXT NOT NULL DEFAULT '',
  loop_traslape_real  TEXT NOT NULL DEFAULT '',
  loop_costurado_real TEXT NOT NULL DEFAULT '',
  loop_color_real  TEXT NOT NULL DEFAULT '',
  diam_spec   TEXT NOT NULL DEFAULT '',
  diam_real   TEXT NOT NULL DEFAULT '',
  material_spec  TEXT NOT NULL DEFAULT '',
  material_real  TEXT NOT NULL DEFAULT '',
  filler1     BOOLEAN NOT NULL DEFAULT false,
  filler2     BOOLEAN NOT NULL DEFAULT false,
  folt     BOOLEAN NOT NULL DEFAULT false,
  pc       BOOLEAN NOT NULL DEFAULT false,
  observaciones  TEXT NOT NULL DEFAULT '',
  capturado_por  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoja_verif_rawbag_orden ON hoja_verif_rawbag (orden_id, fecha, id);

-- ─── Control de mesas de calidad (Calidad) ─────────────────────────────────────
-- Una fila por HOJA física (día + turno). Cada hoja trae 4 mesas de 2 personas
-- y el conteo de sacos revisados por mesa (la retícula de 1 a 175 del papel).
-- Una mesa solo cuenta cuando está ACTIVA, y solo se puede activar con sus dos
-- operadores registrados. El avance del área es la suma de las mesas activas de
-- todas las hojas contra los sacos de la orden.
CREATE TABLE IF NOT EXISTS hoja_calidad (
  id            BIGSERIAL PRIMARY KEY,
  orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  turno         TEXT NOT NULL DEFAULT '',
  supervisor    TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  m1_op1        TEXT NOT NULL DEFAULT '',
  m1_op2        TEXT NOT NULL DEFAULT '',
  m1_activa     BOOLEAN NOT NULL DEFAULT false,
  m1_total      INTEGER NOT NULL DEFAULT 0,
  m2_op1        TEXT NOT NULL DEFAULT '',
  m2_op2        TEXT NOT NULL DEFAULT '',
  m2_activa     BOOLEAN NOT NULL DEFAULT false,
  m2_total      INTEGER NOT NULL DEFAULT 0,
  m3_op1        TEXT NOT NULL DEFAULT '',
  m3_op2        TEXT NOT NULL DEFAULT '',
  m3_activa     BOOLEAN NOT NULL DEFAULT false,
  m3_total      INTEGER NOT NULL DEFAULT 0,
  m4_op1        TEXT NOT NULL DEFAULT '',
  m4_op2        TEXT NOT NULL DEFAULT '',
  m4_activa     BOOLEAN NOT NULL DEFAULT false,
  m4_total      INTEGER NOT NULL DEFAULT 0,
  capturado_por TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoja_calidad_orden ON hoja_calidad (orden_id, fecha, id);

-- ─── Defectos y hallazgos en proceso (Calidad) ─────────────────────────────────
-- Un renglón por saco con hallazgo: mesa, etiqueta, máquina, operador, tipo de
-- defecto (catálogo PS, MP, HD…) y si se aprobó o se rechazó.
-- Es solo registro: no afecta el avance del área.
CREATE TABLE IF NOT EXISTS hoja_defectos (
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
);
CREATE INDEX IF NOT EXISTS hoja_defectos_orden ON hoja_defectos (orden_id, fecha, id);

-- ─── Salida y entrega de materiales a producción (Almacén) ────────────────────
-- Una fila por ENTREGA (la hoja física) y una por renglón de material.
-- `resumen` marca las filas sombreadas del papel: el total por familia de
-- material, sin etiqueta ni factura. El avance del área son los sacos cuyo
-- material ya salió a producción.
CREATE TABLE IF NOT EXISTS hoja_almacen (
  id                    BIGSERIAL PRIMARY KEY,
  orden_id              TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  cantidad_entregada    INTEGER NOT NULL DEFAULT 0,
  firma_entrega         TEXT NOT NULL DEFAULT '',
  firma_recepcion_corte TEXT NOT NULL DEFAULT '',
  firma_recepcion_prod  TEXT NOT NULL DEFAULT '',
  firma_recepcion_alm   TEXT NOT NULL DEFAULT '',
  firma_entrega_corte   TEXT NOT NULL DEFAULT '',
  capturado_por         TEXT,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoja_almacen_orden ON hoja_almacen (orden_id, fecha, id);

-- Un renglón por ROLLO entregado. La familia de tela se deduce del código
-- (SCFLF6CW48RAF → 6CW48), así que aquí no se captura ni se repite.
CREATE TABLE IF NOT EXISTS hoja_almacen_material (
  id        BIGSERIAL PRIMARY KEY,
  hoja_id   BIGINT NOT NULL REFERENCES hoja_almacen(id) ON DELETE CASCADE,
  material  TEXT NOT NULL DEFAULT '',
  etiqueta  TEXT NOT NULL DEFAULT '',
  factura   TEXT NOT NULL DEFAULT '',
  tag       TEXT NOT NULL DEFAULT '',
  cantidad  NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad    TEXT NOT NULL DEFAULT '',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoja_almacen_material_hoja ON hoja_almacen_material (hoja_id, id);

-- Consumo y devolución van POR FAMILIA: es donde los anota el papel (el
-- renglón sombreado). La cantidad entregada de la familia NO se guarda: es la
-- suma de sus rollos, calculada al vuelo.
CREATE TABLE IF NOT EXISTS hoja_almacen_consumo (
  hoja_id          BIGINT NOT NULL REFERENCES hoja_almacen(id) ON DELETE CASCADE,
  familia          TEXT NOT NULL,
  consumo_esperado NUMERIC(12,2) NOT NULL DEFAULT 0,
  devolucion_real  NUMERIC(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (hoja_id, familia)
);

-- ─── Control de tarimas y sacos en prensa (Empaque) ────────────────────────────
-- Una fila por TARIMA: su fecha, número consecutivo, el conteo de sacos
-- prensados (la retícula de 1 a 200 del papel) y el peso en libras.
-- El avance del área es la suma de todas las tarimas contra los sacos de la orden.
CREATE TABLE IF NOT EXISTS hoja_empaque (
  id            BIGSERIAL PRIMARY KEY,
  orden_id      TEXT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL DEFAULT 1,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  turno         TEXT NOT NULL DEFAULT '',
  contados      INTEGER NOT NULL DEFAULT 0,
  peso          INTEGER NOT NULL DEFAULT 0,
  capturado_por TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoja_empaque_orden ON hoja_empaque (orden_id, numero, id);

-- ─── Avances de producción (por área y componente) ──────────────────────────────
-- Cada fila es un componente que un supervisor reporta (meta vs. hecho).
-- Se generan automáticamente al crear la orden (ver src/lib/produccion.ts).
CREATE TABLE IF NOT EXISTS avances (
  id         BIGSERIAL PRIMARY KEY,
  orden_id   TEXT     NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  area       TEXT     NOT NULL,
  comp_idx   SMALLINT NOT NULL,
  nombre     TEXT     NOT NULL,
  meta       INTEGER  NOT NULL,
  hecho      INTEGER  NOT NULL DEFAULT 0,
  UNIQUE (orden_id, area, comp_idx)
);



