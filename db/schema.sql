-- =====================================================================
-- Presupuesto Institucional 2027 - COAC Once de Junio
-- Etapa 1: esquema de base de datos (Turso / SQLite)
--
-- Principio de diseno: separar datos "por agencia" (se repiten para las
-- 10 agencias, con supuestos propios) de datos "departamentales"
-- (presupuesto institucional unico que se prorratea entre agencias).
-- Esto evita mezclar dos naturalezas de dato en una sola tabla, que fue
-- una de las causas de formulas duplicadas/inconsistentes en la
-- herramienta de indicadores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catalogos
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agencias (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT NOT NULL UNIQUE,
  nombre            TEXT NOT NULL,
  porcentaje_activo REAL,
  es_matriz         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalogo_cuentas (
  codigo    TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  grupo     TEXT NOT NULL CHECK (grupo IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','GASTO')),
  nivel     INTEGER
);

-- ---------------------------------------------------------------------
-- Datos "por agencia" — saldo inicial (punto de partida del presupuesto)
-- ---------------------------------------------------------------------
-- Incluye anio/mes: el saldo inicial no es fijo a un solo periodo — la
-- administracion puede decidir proyectar desde cualquier mes, y cada
-- ciclo de presupuesto (2027, 2028...) necesita su propio punto de
-- partida sin pisar el anterior.

CREATE TABLE IF NOT EXISTS saldos_iniciales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id    INTEGER NOT NULL REFERENCES agencias(id),
  cuenta_codigo TEXT NOT NULL REFERENCES catalogo_cuentas(codigo),
  anio          INTEGER NOT NULL,
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto         REAL NOT NULL DEFAULT 0,
  UNIQUE (agencia_id, cuenta_codigo, anio, mes)
);

-- ---------------------------------------------------------------------
-- Datos "por agencia" — parametros de colocacion de credito (hoja Credito)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parametros_credito (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id                INTEGER NOT NULL REFERENCES agencias(id),
  linea                     TEXT NOT NULL CHECK (linea IN ('PRODUCTIVO','CONSUMO','INMOBILIARIO','MICROCREDITO')),
  mes                       INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  modo_colocacion           TEXT NOT NULL DEFAULT 'META' CHECK (modo_colocacion IN ('META','CAPACIDAD_ARCHIVO')),
  monto_promedio            REAL NOT NULL DEFAULT 0,
  tasa_interes_anual        REAL NOT NULL DEFAULT 0,
  pct_recuperacion_periodo  REAL NOT NULL DEFAULT 0,
  tasa_efectividad_recup    REAL NOT NULL DEFAULT 0,
  num_operaciones_iniciales INTEGER,
  num_operaciones_conceder  REAL NOT NULL DEFAULT 0,
  num_admin_por_oficial     REAL,
  tasa_recuperacion_vencida REAL NOT NULL DEFAULT 0,
  monto_fijo_conceder       REAL NOT NULL DEFAULT 0,
  UNIQUE (agencia_id, linea, mes)
);

CREATE TABLE IF NOT EXISTS oficiales_credito (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id  INTEGER NOT NULL REFERENCES agencias(id),
  nombre      TEXT NOT NULL,
  rango       TEXT NOT NULL CHECK (rango IN ('JUNIOR','SENIOR','MASTER')),
  meta_mensual REAL NOT NULL
);

-- ---------------------------------------------------------------------
-- Datos "por agencia" — captaciones (hojas Operaciones + Captaciones)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parametros_captaciones (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id          INTEGER NOT NULL REFERENCES agencias(id),
  producto            TEXT NOT NULL CHECK (producto IN ('VISTA','CRECER','DPF')),
  mes                 INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  tasa_interes_anual  REAL NOT NULL DEFAULT 0,
  pct_ingresos        REAL,
  pct_retiros         REAL,
  pct_liquidez        REAL NOT NULL DEFAULT 0,
  cuentas_nuevas      INTEGER,
  pct_cancelaciones   REAL,
  ratio_renovaciones  REAL,
  UNIQUE (agencia_id, producto, mes)
);

-- ---------------------------------------------------------------------
-- Datos "departamentales" — presupuesto institucional UNICO (no por agencia)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS presupuesto_departamental (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  departamento TEXT NOT NULL,   -- TH1, TH2, Marketing, Tecnologia, OSI, SSO, Administrativo, Administrativo 2, Gerencia, Contabilidad, Tesoreria
  concepto     TEXT NOT NULL,   -- descripcion de la linea de gasto (ej. "Publicidad y Propaganda 2026")
  mes          INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto        REAL NOT NULL DEFAULT 0,
  agencia_id   INTEGER REFERENCES agencias(id)  -- NULL = gasto institucional (se prorratea por % de Activo);
                                                  -- con valor = gasto directo de esa agencia (no se prorratea)
);

CREATE TABLE IF NOT EXISTS prorrateo_departamental (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  presupuesto_departamental_id INTEGER NOT NULL REFERENCES presupuesto_departamental(id),
  agencia_id                 INTEGER NOT NULL REFERENCES agencias(id),
  monto_prorrateado          REAL NOT NULL
);

-- ---------------------------------------------------------------------
-- Salida del motor de calculo (Etapa 2) — una fuente unica de resultados
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS resultados_motor (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id    INTEGER NOT NULL REFERENCES agencias(id),
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  modulo        TEXT NOT NULL,
  variable      TEXT NOT NULL,
  monto         REAL NOT NULL,
  generado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agencia_id, mes, modulo, variable)
);
-- ---------------------------------------------------------------------
-- Índices (oct-2026): Turso cobra por filas revisadas; con estos índices las consultas por
-- agencia / ejercicio / concepto revisan solo sus filas. lib/turso.ts los crea solo al iniciar.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pd_agencia_ejercicio ON presupuesto_departamental (agencia_id, ejercicio);
CREATE INDEX IF NOT EXISTS idx_pd_depto_concepto ON presupuesto_departamental (departamento, concepto, ejercicio);
CREATE INDEX IF NOT EXISTS idx_pd_concepto ON presupuesto_departamental (concepto, ejercicio);
CREATE INDEX IF NOT EXISTS idx_pd_resumen ON presupuesto_departamental (resumen_id);
CREATE INDEX IF NOT EXISTS idx_pr_depto ON presupuesto_resumen (departamento, ejercicio, nombre);
CREATE INDEX IF NOT EXISTS idx_nomina_agencia ON nomina_empleados (agencia_id, activo);
CREATE INDEX IF NOT EXISTS idx_oficiales_agencia ON oficiales_credito (agencia_id);
CREATE INDEX IF NOT EXISTS idx_inversiones_agencia ON inversiones (agencia_id);
CREATE INDEX IF NOT EXISTS idx_saldos_periodo ON saldos_iniciales (agencia_id, anio, mes);
-- Usuarios de la herramienta. La contrasena se guarda codificada (scrypt + sal),
-- nunca en texto plano. La app tambien crea esta tabla sola al primer inicio de sesion.
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contrasena TEXT NOT NULL
);
-- Columnas agregadas despues (la app las crea sola con ALTER TABLE si faltan):
--   nombre TEXT, es_admin INTEGER DEFAULT 0, activo INTEGER DEFAULT 1,
--   version_sesion INTEGER DEFAULT 1 (sube al cambiar contrasena o desactivar: cierra sesiones),
--   creado_en TEXT
--   correo TEXT (para recuperar la contrasena), debe_cambiar INTEGER DEFAULT 0 (obliga a crear una nueva),
--   clave_temporal TEXT (codificada), clave_temporal_expira TEXT, ultimo_restablecimiento TEXT

-- ---------------------------------------------------------------------
-- Tablas que la herramienta crea sola la primera vez que se usan
-- (CREATE TABLE IF NOT EXISTS en el código; no hace falta correr nada a mano):
--   usuarios                         lib/usuarios.ts
--   datos_version                    lib/turso.ts            (versión de datos: cada escritura la sube)
--   cache_resultados                 lib/cache-persistente.ts (resultados calculados por versión de programa y datos)
--   inversiones, inversiones_parametros               lib/inversiones.ts
--   parametros_fondos_agencia, parametros_fondos_institucional (incluye pct_encaje)  lib/parametros-fondos.ts
--   parametros_produccion            lib/parametros-produccion.ts
--   parametros_provision, parametros_provision_mes    lib/parametros-provision.ts
--   activos_fijos                    app/api/activos-fijos-registro/route.ts
--   notas_reporte                    app/api/notas-reporte/route.ts
--   provision_calificacion, provision_eerr, provision_flow_parametros, provision_flow_config
--                                    lib/provision-flow-db.ts (modelo de provisión por flow rates; se siembran con lib/provision-semilla.ts)
-- Los saldos proyectados (Balance, cuenta 11 Fondos disponibles y sus subcuentas, 16, 18, 19…)
-- no se guardan como datos: se calculan desde saldos_iniciales y los parámetros, y solo
-- quedan en cache_resultados para abrir rápido.
