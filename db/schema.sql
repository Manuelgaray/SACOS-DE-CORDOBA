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
  -- Token de la sesión vigente. Cada login genera uno nuevo; los dispositivos
  -- con un token distinto se cierran solos (una sola sesión activa por usuario).
  session_token  TEXT
);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_token TEXT;

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
  -- Elementos de corte para la explosión de materiales (ver src/lib/explosion.ts).
  corte_elementos JSONB
);

-- Para bases ya creadas antes de agregar la explosión de materiales (idempotente).
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS corte_elementos JSONB;

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



