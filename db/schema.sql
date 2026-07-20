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

CREATE TABLE IF NOT EXISTS specs (
  spec     TEXT PRIMARY KEY,
  cliente  TEXT NOT NULL REFERENCES clientes(nombre) ON UPDATE CASCADE ON DELETE CASCADE
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



