/**
 * Orquestador — encadena los 8 motores puros de lib/calc/ usando:
 *  - Saldos iniciales REALES (tabla saldos_iniciales, balance Dic-2025 de Matriz)
 *  - Parámetros de Captaciones REALES (tabla parametros_captaciones)
 *  - Parámetros de Crédito REALES (tabla parametros_credito)
 *  - Para todo lo demás (gastos institucionales TH1/TH2/Gerencia/etc., plan de
 *    adquisiciones de activo fijo, y varios flujos de Pasivo/Otros Activos que
 *    no tienen pantalla propia todavía) se usan las cifras de referencia ya
 *    validadas contra el Excel corregido — son datos reales, solo que no
 *    editables desde una pantalla todavía. Se irán reemplazando a medida que
 *    se construyan sus pantallas de parametrización (fase "Presupuesto
 *    departamental").
 *
 * Los códigos de cuenta van SIN PUNTOS (formato real de saldos_iniciales,
 * ej. "1101", "149905"), confirmado contra el balance real de Matriz.
 */

import { parametrosVigentesDe } from "./parametros-vigentes";
import { calcularCaptaciones } from "./captaciones";
import type { ResultadoMensual } from "./tipos";
import { calcularLineaCartera, type ParametrosLineaCartera } from "./cartera";
import {
  calcularActivoFijoCategoria,
  calcularTerrenos,
  CATEGORIAS_ACTIVO_FIJO_MATRIZ,
  depreciacionRegistroDe,
} from "./activo-fijo";
import { calcularOtrosActivosMatriz, calcularFondoLiquidez, calcularRollforwardSimple, INPUT_OTROS_ACTIVOS_MATRIZ } from "./otros-activos";
import { calcularPasivoMatriz, calcularCuentasPorPagar, calcularCreditoExterno, calcularTransferenciasInternasRecibidas, INPUT_PASIVO_MATRIZ } from "./pasivo";
import { calcularPatrimonioMatriz, type ConfigCapitalSocial, CONFIG_CAPITAL_SOCIAL_MATRIZ, calcularDetalleCapitalSocial } from "./patrimonio";
import {
  calcularIngresosEgresosMatriz,
  type ParametrosLineaProvision,
  saldoProvisionMes,
  type InputExternoInstitucional,
} from "./ingresos-egresos";
import { calcularFlujoEfectivoMatriz } from "./flujo-efectivo";
import { calcularTotalesNomina, calcularLineasProvisionMensuales, type Empleado } from "./th1";
import { calcularProvisionLinea, parametrosProvisionDe, type ResultadoProvisionLinea } from "./provision";
import { calcularProvisionFlowAgencia, filasSinRecuperaciones, type ProvisionFlowAgencia } from "./provision-flow-integracion";
import { rendimientoFLDe } from "./otros-activos";
import { provisionFlowDe, factorMoraDe, factorVencidaDe, precancelacionRealDe, type SupuestosMora, type Producto as ProductoFlow } from "./provision-flow";
import { inversionesDe } from "./inversiones";
import { diferidosDe } from "./activos-diferidos";
import { prestamosInternosDe } from "./prestamos-internos";
import { cuentaCalculada } from "./cuentas-calculadas";
import { contribucionesDe, tasasContribuciones, calcularCosede, calcularSeps } from "./contribuciones";
import { parametrosFondosDe, limiteCaja, repartirFondosPorReglas, calcularFondosRequeridos, pctEncajeDe, pctTextoEncaje } from "./fondos";

export type SaldosPorCodigo = Record<string, number>;

function s(saldos: SaldosPorCodigo, codigo: string): number {
  const v = saldos[codigo];
  if (v === undefined) {
    console.warn(`[orquestador] cuenta ${codigo} no encontrada en saldos_iniciales, usando 0`);
    return 0;
  }
  return v;
}

function suma(saldos: SaldosPorCodigo, codigos: string[]): number {
  return codigos.reduce((acc, c) => acc + s(saldos, c), 0);
}

type Producto = "VISTA" | "CRECER" | "DPF";
export type Linea = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";

export interface FilaParametroCaptaciones {
  producto: Producto;
  mes: number;
  tasa_interes_anual: number;
  pct_ingresos: number | null;
  pct_retiros: number | null;
  pct_cancelaciones: number | null;
  ratio_renovaciones: number | null;
  pct_liquidez?: number | null;   // % de liquidez requerida del producto (saldo final × %)
}

export interface FilaParametroCredito {
  linea: Linea;
  mes: number;
  monto_promedio: number;
  tasa_interes_anual: number;
  pct_recuperacion_periodo: number;
  tasa_efectividad_recup: number;
  num_operaciones_conceder: number;
  tasa_recuperacion_vencida: number;
  pct_distribucion: number | null;
  /** % mensual de la cartera por vencer que pasa a riesgo; vacío = (1 − efectividad) × % de recuperación del período. */
  pct_pase_riesgo?: number | null;
  /** % mensual de la cartera por vencer que se precancela con dinero (sin refinanciamientos, reestructurados ni novaciones); vacío = 0. */
  pct_precancelacion?: number | null;
  /** % mensual del saldo en riesgo que se precancela con dinero; vacío = ritmo real × el margen de la cartera por vencer. */
  pct_precancelacion_vencida?: number | null;
}

/**
 * Tasas y porcentajes por mes. Un mes sin fila guardada (parámetro guardado a medias) toma el del
 * mes anterior que sí tiene (o el primero guardado), en lugar de 0: un 0 de cumplimiento o de tasa
 * apagaba la colocación o el interés del resto del año sin aviso. Un 0 escrito sí se respeta.
 */
function rellenarMeses(porMes: (number | null)[]): number[] {
  const primero = porMes.find((v) => v !== null);
  if (primero === undefined) return Array(12).fill(0);
  let previo: number = primero as number;
  return porMes.map((v) => (v === null ? previo : (previo = v)));
}

function arr12(filas: any[], campo: string): number[] {
  const porMes: (number | null)[] = Array(12).fill(null);
  for (const f of filas) {
    const mes = f.mes as number;
    if (mes >= 1 && mes <= 12) porMes[mes - 1] = (f[campo] as number) ?? 0;
  }
  return rellenarMeses(porMes);
}

/** Igual que arrPorConcepto, para porcentajes: los meses sin fila toman el mes guardado anterior. */
function pctPorConcepto(filas: FilaParametroOtrosPasivo[], concepto: string): number[] {
  const porMes: (number | null)[] = Array(12).fill(null);
  for (const f of filas) {
    if (f.concepto === concepto && f.mes >= 1 && f.mes <= 12) porMes[f.mes - 1] = f.monto;
  }
  return rellenarMeses(porMes);
}

/** Catálogo SEPS: por vencer (normal, refinanciada, reestructurada) y en riesgo (no devenga
 *  intereses y vencida, cada una normal, refinanciada y reestructurada). Una cuenta que no
 *  venga en el balance cuenta como 0. */
export const CODIGOS_CARTERA: Record<Linea, { porVencer: string[]; enRiesgo: string[] }> = {
  PRODUCTIVO: {
    porVencer: ["1401", "1409", "1417"],
    enRiesgo: ["1425", "1433", "1441", "1449", "1457", "1465"],
  },
  CONSUMO: {
    porVencer: ["1402", "1410", "1418"],
    enRiesgo: ["1426", "1434", "1442", "1450", "1458", "1466"],
  },
  INMOBILIARIO: {
    porVencer: ["1403", "1411", "1419"],
    enRiesgo: ["1427", "1435", "1443", "1451", "1459", "1467"],
  },
  MICROCREDITO: {
    porVencer: ["1404", "1412", "1420"],
    enRiesgo: ["1428", "1436", "1444", "1452", "1460", "1468"],
  },
};

export const CODIGOS_PROVISION_CARTERA: Record<Linea, string[]> = {
  PRODUCTIVO: ["149905", "14994505", "14995020"],
  CONSUMO: ["149910", "14994510", "14995010"],
  INMOBILIARIO: ["149915", "14994515", "14995011"],
  MICROCREDITO: ["149920", "14994520", "14995015"],
};

const CODIGO_PROVISION_GENERICA = "149980";

/** % de provisión de respaldo (Excel dic-2025): solo se usa si una línea no
 *  tiene cartera en el balance cargado. El % normal sale del balance y de
 *  Cartera → Parámetros → Provisión (ver lib/calc/provision.ts). */
const RATIO_PROVISION: Record<Linea, number> = {
  PRODUCTIVO: 0.0156747069446214,
  CONSUMO: 0.0975,
  INMOBILIARIO: 0.0728,
  MICROCREDITO: 0.1928,
};

export const RELACION_MORA_INTERES_NORMAL = 0.05;

export interface FilaOficialCredito {
  rango: "JUNIOR" | "SENIOR" | "MASTER";
  activo: number;
}

export interface MetasCreditoInstitucional {
  meta_junior: number;
  meta_senior: number;
  meta_master: number;
  minimo_operaciones: number;
  relacion_mora: number;
}

function calcularMetaColocacionAgencia(oficiales: FilaOficialCredito[], metas: MetasCreditoInstitucional): number {
  const metaPorRango: Record<FilaOficialCredito["rango"], number> = {
    JUNIOR: metas.meta_junior,
    SENIOR: metas.meta_senior,
    MASTER: metas.meta_master,
  };
  return oficiales.filter((o) => o.activo === 1).reduce((sum, o) => sum + (metaPorRango[o.rango] ?? 0), 0);
}

export const PCT_DISTRIBUCION_DEFAULT: Record<Linea, number> = {
  PRODUCTIVO: 0,
  CONSUMO: 0.8,
  INMOBILIARIO: 0,
  MICROCREDITO: 0.2,
};

/** Cuentas contables de cada categoría de activo fijo: costo (18), depreciación acumulada (1899) y gasto (4505). */
export const CODIGO_AF: Record<string, { costo: string; dep: string; gasto: string }> = {
  Edificios: { costo: "1802", dep: "189905", gasto: "450515" },
  "Muebles de oficina": { costo: "18050501", dep: "18991501", gasto: "45052505" },
  "Equipo de oficina": { costo: "18050502", dep: "18991502", gasto: "45052510" },
  "Enseres de Oficina": { costo: "18050503", dep: "18991503", gasto: "45052515" },
  "Equipos de Computación": { costo: "1806", dep: "189920", gasto: "450530" },
  "Unidades de Transporte": { costo: "1807", dep: "189925", gasto: "450535" },
  "Otros Activos": { costo: "1890", dep: "189940", gasto: "450590" },
};

/**
 * Filas con códigos de distinto largo bajo una cuenta → árbol por niveles (4, 6, 8 dígitos), con las cuentas madre
 * intermedias (nombre del catálogo, lo pone nombrarCuentas). Ej.: 18050501, 18050502, 18050503 → 1805 → 180505 → las tres.
 */
export function anidarPorCodigo(raiz: string, filas: NodoBalance[]): NodoBalance[] {
  const siguiente = (n: number) => (n < 4 ? 4 : n + 2);
  const armar = (prefijo: string, hs: NodoBalance[]): NodoBalance[] => {
    const largo = siguiente(prefijo.length);
    const grupos = new Map<string, NodoBalance[]>();
    for (const h of hs) { const k = h.codigo.slice(0, largo); grupos.set(k, [...(grupos.get(k) ?? []), h]); }
    return [...grupos.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, g]) =>
      g.length === 1 && g[0].codigo.length <= largo ? g[0]
        : { codigo: k, label: k, valores: Array.from({ length: 12 }, (_, i) => g.reduce((t, h) => t + (h.valores[i] ?? 0), 0)), hijos: armar(k, g) });
  };
  return armar(raiz, filas);
}

export type FactoresDepreciacion = Record<string, number>;

function factorParaCategoria(nombre: string, factores: FactoresDepreciacion | undefined): number {
  if (factores && factores[nombre] !== undefined) return factores[nombre];
  return CATEGORIAS_ACTIVO_FIJO_MATRIZ.find((c) => c.nombre === nombre)?.tasa_anual ?? 0;
}

/** Una fila cruda de la tabla otros_pasivo_parametros (Otros Activos 19 / Pasivo 25-29). */
export interface FilaParametroOtrosPasivo {
  concepto: string;
  mes: number;
  monto: number;
}

function arrPorConcepto(filas: FilaParametroOtrosPasivo[], concepto: string): number[] {
  const porMes = Array(12).fill(0);
  for (const f of filas) {
    if (f.concepto === concepto && f.mes >= 1 && f.mes <= 12) porMes[f.mes - 1] = f.monto;
  }
  return porMes;
}

/** Si la agencia tiene filas guardadas para este concepto, se usan tal cual (aunque sean $0).
 *  Si no tiene ninguna, el valor es $0 en todas las agencias, Matriz incluida: ya no se usan las
 *  cifras fijas del Excel de referencia (todo valor sale de lo que se guarda en la herramienta).
 *  Los parámetros fallbackMatriz/esMatriz se conservan solo por compatibilidad de la firma. */
function valorPorConceptoOFijo(
  filas: FilaParametroOtrosPasivo[],
  concepto: string,
  fallbackMatriz: number[],
  esMatriz: boolean
): number[] {
  const tieneDatos = filas.some((f) => f.concepto === concepto);
  if (tieneDatos) return arrPorConcepto(filas, concepto);
  void fallbackMatriz; void esMatriz;
  return Array(12).fill(0);
}

/**
 * Devolución promedio por socio retirado (12 meses). Guardada si existe el
 * concepto "capital_social_devolucion_promedio"; si no, estimada como
 * saldo 31 ÷ socios al inicio; si tampoco se puede, el monto obligatorio.
 */
function devolucionPromedioSocio(filas: FilaParametroOtrosPasivo[], saldo31: number, sociosInicial: number, montoAporte: number[]): number[] {
  if (filas.some((f) => f.concepto === "capital_social_devolucion_promedio")) return arrPorConcepto(filas, "capital_social_devolucion_promedio");
  if (sociosInicial > 0 && saldo31 > 0) return Array(12).fill(saldo31 / sociosInicial);
  return [...montoAporte];
}

function totalMensualPorConceptoExacto(filas: FilaPresupuestoDepartamental[], codigo: string): number[] {
  const total = Array(12).fill(0);
  for (const f of filas) {
    if (f.concepto.replace(/\D/g, "") === codigo && f.mes >= 1 && f.mes <= 12) {
      total[f.mes - 1] += f.monto;
    }
  }
  return total;
}

export interface FilaPresupuestoDepartamental {
  departamento: string;
  concepto: string;
  cuenta_nombre: string | null;
  mes: number;
  monto: number;
}

export interface FilaEmpleadoNomina {
  nombre: string;
  basico_2025: number;
  incremento_pct: number;
  movilizacion_anual: number;
}

type ClaveInstitucional = keyof InputExternoInstitucional;

export function claveConceptoPorCuenta(codigoCrudo: string): ClaveInstitucional | null {
  const c = codigoCrudo.replace(/\D/g, "");
  // Calculadas por la herramienta (no salen de lo cargado): SEPS y COSEDE (lib/calc/contribuciones), intereses causados,
  // provisiones, depreciaciones, amortizaciones, suministros e intereses de cartera.
  // Interés pagado a otras oficinas por préstamos internos (41059005): lo calcula Ingresos 51 con el 2908 y la tasa
  // interna, y entra como gasto (grupo 41), al resultado y al flujo.
  if (c.startsWith("410590")) return "otrosEgresosAdicionalesPorMes";
  if (cuentaCalculada(c)) return null;
  // Resto de 4504 (450405 impuestos fiscales, 450410 municipales, 450430 multas, 450490 otros): antes solo
  // entraban 450410/450430/450490 y lo demás cargado en la hoja se perdía sin llegar al Estado de resultados.
  if (c.startsWith("4504")) return "impuestosMunicipalesYOtrosPorMes";
  if (c.startsWith("4501")) return "gastosPersonalPorMes";
  if (c.startsWith("4502")) return "honorariosPorMes";
  if (c.startsWith("4503")) return "serviciosVariosPorMes";
  if (c.startsWith("450705")) return null;
  if (c.startsWith("4507")) return "otrosGastosOperInstitucionalPorMes";
  if (c.startsWith("42")) return "comisionesCausadasPorMes";
  if (c.startsWith("47")) return "otrosGastosYPerdidasPorMes";
  if (c.startsWith("48")) return "participacionEmpleadosEImpuestoRentaPorMes";
  if (c.startsWith("5104")) return null;
  if (c.startsWith("51")) return "depositosEInversionesPorMes";
  if (c.startsWith("53")) return "utilidadesFinancierasPorMes";
  if (c.startsWith("54")) return "ingresosPorServiciosPorMes";
  if (c.startsWith("55")) return "otrosIngresosOperacionalesPorMes";
  if (c.startsWith("56")) return "otrosIngresosPorMes";
  if (c.startsWith("52")) return "comisionesGanadasCarteraPorMes";
  // Cualquier otra cuenta de gasto o ingreso cargada en el presupuesto también entra al resultado (y al flujo)
  if (c.startsWith("4")) return "otrosEgresosAdicionalesPorMes";
  if (c.startsWith("5")) return "otrosIngresosAdicionalesPorMes";
  return null;
}

export { cuentaCalculada } from "./cuentas-calculadas";

const CLAVES_INSTITUCIONALES: ClaveInstitucional[] = [
  "gastosPersonalPorMes", "honorariosPorMes", "serviciosVariosPorMes", "impuestosMunicipalesYOtrosPorMes",
  "aportesSEPSPorMes", "comisionesCausadasPorMes", "otrosGastosOperInstitucionalPorMes", "otrosGastosYPerdidasPorMes",
  "participacionEmpleadosEImpuestoRentaPorMes", "comisionesGanadasCarteraPorMes", "utilidadesFinancierasPorMes",
  "ingresosPorServiciosPorMes", "otrosIngresosOperacionalesPorMes", "otrosIngresosPorMes", "depositosEInversionesPorMes",
  "otrosEgresosAdicionalesPorMes", "otrosIngresosAdicionalesPorMes",
];

function extraerCuentaPorMes(filas: FilaPresupuestoDepartamental[], codigo: string): number[] {
  const porMes = Array(12).fill(0);
  for (const f of filas) {
    if (f.concepto.replace(/\D/g, "") === codigo && f.mes >= 1 && f.mes <= 12) {
      porMes[f.mes - 1] += f.monto;
    }
  }
  return porMes;
}

/** COSEDE y SEPS de la agencia con sus tasas (guardadas, reales del histórico o de la norma). */
/** Supuestos de cartera por línea que mueven el modelo de provisión: pase a riesgo equivalente y recuperación de vencida (promedio del año). */
function supuestosMoraDe(paramsCredito: FilaParametroCredito[], factorVencida = 1): SupuestosMora {
  const sup: SupuestosMora = { pase: {}, rv: {} };
  for (const l of ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as ProductoFlow[]) {
    const fs = paramsCredito.filter((f) => f.linea === l && f.pct_recuperacion_periodo > 0);
    if (!fs.length) continue;
    sup.pase[l] = fs.reduce((t, f) => t + (f.pct_pase_riesgo ?? f.pct_recuperacion_periodo * (1 - f.tasa_efectividad_recup)), 0) / fs.length;
    sup.rv[l] = (fs.reduce((t, f) => t + (f.tasa_recuperacion_vencida || 0), 0) / fs.length) * factorVencida;
  }
  return sup;
}

function calcularContribucionesAgencia(saldos: SaldosPorCodigo, parametrosOtrosPasivo: FilaParametroOtrosPasivo[], obligaciones21: { corte: number; porMes: number[] }) {
  const ins = contribucionesDe(saldos);
  const tasas = tasasContribuciones(parametrosOtrosPasivo, ins);
  const cosede = calcularCosede(obligaciones21.corte, obligaciones21.porMes, tasas);
  // Activo del balance de partida (grupo 1 o la suma de sus grupos) y su estimado de ene–jun: crece con las captaciones
  const activoCorte = Number(saldos["1"]) || ["11", "12", "13", "14", "15", "16", "17", "18", "19"].reduce((t, k) => t + (Number(saldos[k]) || 0), 0);
  const capt1 = obligaciones21.porMes.slice(0, 6).reduce((t, v) => t + v, 0) / 6;
  const activosPrimerSemestre = activoCorte + (capt1 - obligaciones21.corte);
  const seps = calcularSeps({ activoCorte, activosPrimerSemestre, ins, t: tasas });
  return { tasas, cosede, seps, insumos: ins };
}

/** Gasto mensual de la nómina (Talento Humano): sueldo, décimos, fondo de reserva e IESS patronal. null = sin nómina. */
export function lineasNominaPorMes(filas: FilaPresupuestoDepartamental[], empleados: FilaEmpleadoNomina[] = []) {
  if (empleados.length === 0) return null;
  const empleadosCalc: Empleado[] = empleados.map((e) => ({
    nombre: e.nombre,
    basico2025: e.basico_2025,
    incrementoPct: e.incremento_pct,
    movilizacionAnual: e.movilizacion_anual,
  }));
  const vigentes = parametrosVigentesDe(empleados);
  const totalesNomina = calcularTotalesNomina(empleadosCalc, vigentes);
  return calcularLineasProvisionMensuales(totalesNomina, {
    horasExtrasPorMes: extraerCuentaPorMes(filas, "45019005"),
    comisionesPorMes: extraerCuentaPorMes(filas, "45019010"),
    otrosGastosPersonalPorMes: extraerCuentaPorMes(filas, "45019090"),
    subrogacionesPorMes: extraerCuentaPorMes(filas, "45019095"),
  }, vigentes);
}

function construirInputInstitucional(
  filas: FilaPresupuestoDepartamental[],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz"
): InputExternoInstitucional {
  const cero = Object.fromEntries(
    CLAVES_INSTITUCIONALES.map((clave) => [clave, Array(12).fill(0)])
  ) as unknown as InputExternoInstitucional;

  const base: InputExternoInstitucional =
    filas.length === 0
      ? cero // sin presupuesto cargado: $0 (ya no se usan las cifras fijas del Excel de referencia)
      : (() => {
          const resultado = Object.fromEntries(
            CLAVES_INSTITUCIONALES.map((clave) => [clave, Array(12).fill(0)])
          ) as unknown as InputExternoInstitucional;

          for (const fila of filas) {
            const clave = claveConceptoPorCuenta(fila.concepto);
            if (!clave) continue;
            if (fila.mes < 1 || fila.mes > 12) continue;
            resultado[clave][fila.mes - 1] += fila.monto;
          }
          return resultado;
        })();

  const lineas = lineasNominaPorMes(filas, empleados);
  if (!lineas) return base;

  const gastosPersonalPorMes = base.gastosPersonalPorMes.map(
    (v, i) =>
      v +
      lineas.sueldoPorMes[i] +
      lineas.decimoCuartoPorMes[i] +
      lineas.decimoTerceroPorMes[i] +
      lineas.fondoReservaPorMes[i] +
      lineas.iessPatronalPorMes[i]
  );

  return { ...base, gastosPersonalPorMes };
}
/** Cuentas del grupo 21 que proyecta el motor de Captaciones. */
/** Subcuentas contables de cada producto de captaciones. */
export const CUENTAS_CAPTACIONES = { vista: ["21013505", "21013510", "21013535"], crecer: ["21013515"], dpf: ["2103"] };
const CUENTAS_CAPTACIONES_21 = [...CUENTAS_CAPTACIONES.vista, ...CUENTAS_CAPTACIONES.crecer, ...CUENTAS_CAPTACIONES.dpf];

/** Obligaciones con el público (grupo 21) proyectadas: lo que proyecta Captaciones más
 *  las demás cuentas del grupo 21, que se mantienen en su saldo del corte. Es la base
 *  del Fondo de Liquidez, la misma en todos los meses. */
function obligacionesPublicoProyectadas(saldos: SaldosPorCodigo, totalCaptacionesPorMes: number[]) {
  const grupo21 = saldos["21"] !== undefined ? Number(saldos["21"]) || 0 : null;
  const captacionesCorte = CUENTAS_CAPTACIONES_21.reduce((a, c) => a + (Number(saldos[c]) || 0), 0);
  const otras = grupo21 === null ? 0 : grupo21 - captacionesCorte;
  return {
    corte: grupo21 ?? captacionesCorte,
    captacionesCorte,
    otras,
    porMes: totalCaptacionesPorMes.map((v) => v + otras),
  };
}

function construirCaptaciones(saldos: SaldosPorCodigo, params: FilaParametroCaptaciones[]) {
  const vista = params.filter((f) => f.producto === "VISTA");
  const crecer = params.filter((f) => f.producto === "CRECER");
  const dpf = params.filter((f) => f.producto === "DPF");

  return calcularCaptaciones({
    saldoInicialVista: suma(saldos, ["21013505", "21013510", "21013535"]),
    paramsVista: {
      tasaInteresAnual: arr12(vista, "tasa_interes_anual"),
      pctIngresosPeriodo: arr12(vista, "pct_ingresos"),
      pctRetirosPeriodo: arr12(vista, "pct_retiros"),
    },
    saldoInicialCrecer: s(saldos, "21013515"),
    paramsCrecer: {
      tasaInteresAnual: arr12(crecer, "tasa_interes_anual"),
      pctIngresosPeriodo: arr12(crecer, "pct_ingresos"),
      pctRetirosPeriodo: arr12(crecer, "pct_retiros"),
    },
    saldoInicialDPF: s(saldos, "2103"),
    paramsDPF: {
      pctCancelaciones: arr12(dpf, "pct_cancelaciones"),
      ratioRenovaciones: arr12(dpf, "ratio_renovaciones"),
    },
  });
}

/**
 * % de cumplimiento de la meta de colocación por mes (Cartera → Colocación → Cumplimiento).
 * Sin dato guardado: 100 % (la colocación es la meta completa de los asesores, como antes).
 */
/**
 * Interés de mora como % del interés normal de la cartera (5104.50 ÷ interés de cartera sin mora), propio de cada agencia
 * (Planificación → Cartera → Supuestos; su real con los meses sin alivio). Sin dato guardado: el valor institucional
 * de antes (metas de crédito), para no cambiar las agencias que todavía no lo revisan.
 */
export const CONCEPTO_INTERES_MORA = "interes_mora_pct";
export function interesMoraDe(filas: FilaParametroOtrosPasivo[]): number | null {
  const x = filas.filter((f) => f.concepto === CONCEPTO_INTERES_MORA);
  return x.length ? x.reduce((t, f) => t + (Number(f.monto) || 0), 0) / x.length : null;
}

export function cumplimientoColocacionDe(filas: FilaParametroOtrosPasivo[]): number[] {
  if (!filas.some((f) => f.concepto === "colocacion_pct_cumplimiento")) return Array(12).fill(1);
  return pctPorConcepto(filas, "colocacion_pct_cumplimiento");
}

function construirLineaCartera(
  saldos: SaldosPorCodigo, params: FilaParametroCredito[], linea: Linea,
  metaAgencia: number, cumplimientoPorMes: number[] = Array(12).fill(1)
) {
  // La recuperación de vencida del presupuesto es el % de las cuotas vencidas del mes (como el reporte de recuperación);
  // el motor la aplica sobre el saldo en riesgo: × (saldo recuperado ÷ cuotas recuperadas) real de la agencia.
  const fv = factorVencidaDe(saldos);
  const filas = params.filter((f) => f.linea === linea);
  // Precancelaciones con dinero (sin refinanciamientos). Las de la cartera en riesgo siguen su ritmo real × el mismo margen
  // que el presupuesto le pone a las de la cartera por vencer (% del presupuesto ÷ % real; 1 = igual que lo real).
  const pctPrec = Array.from({ length: 12 }, (_, i) => Number(filas.find((f) => f.mes === i + 1)?.pct_precancelacion ?? 0) || 0);
  const pr = precancelacionRealDe(saldos);
  // la de cartera en riesgo: la cargada en Tasas y recuperación; vacía = ritmo real × el mismo margen de la cartera por vencer
  const pctPrecVen = pctPrec.map((q, i) => {
    const v = filas.find((f) => f.mes === i + 1)?.pct_precancelacion_vencida;
    return v !== null && v !== undefined ? Number(v) || 0 : pr ? pr.qv * Math.max(0, Math.min(3, q / pr.q)) : 0;
  });
  const pctDistribucionPorMes = Array.from({ length: 12 }, (_, i) => {
    const fila = filas.find((f) => f.mes === i + 1);
    return fila?.pct_distribucion ?? PCT_DISTRIBUCION_DEFAULT[linea];
  });
  // Colocación = meta de los asesores × % de cumplimiento del mes × % de distribución de la línea
  const prestamosAConceder = pctDistribucionPorMes.map((pct, i) => metaAgencia * (cumplimientoPorMes[i] ?? 1) * pct);

  const parametros: ParametrosLineaCartera = {
    tasaInteresAnual: arr12(filas, "tasa_interes_anual"),
    pctRecuperacionPeriodo: arr12(filas, "pct_recuperacion_periodo"),
    tasaEfectividadRecuperacion: arr12(filas, "tasa_efectividad_recup"),
    tasaRecuperacionCarteraVencida: arr12(filas, "tasa_recuperacion_vencida").map((x) => x * fv),
    prestamosAConceder,
    pctPaseRiesgo: Array.from({ length: 12 }, (_, i) => { const v = filas.find((f) => f.mes === i + 1)?.pct_pase_riesgo; return v === null || v === undefined ? null : Number(v); }),
    pctPrecancelacion: pctPrec,
    pctPrecancelacionVencida: pctPrecVen,
  };

  const resultado = calcularLineaCartera(
    suma(saldos, CODIGOS_CARTERA[linea].porVencer),
    suma(saldos, CODIGOS_CARTERA[linea].enRiesgo),
    parametros
  );

  return { ...resultado, metaAgencia, cumplimientoPorMes, pctDistribucionPorMes, parametrosUsados: parametros };
}

export function construirTodosLosMotores(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito: MetasCreditoInstitucional = { meta_junior: 110000, meta_senior: 125000, meta_master: 135000, minimo_operaciones: 15, relacion_mora: RELACION_MORA_INTERES_NORMAL },
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
) {
  const esMatriz = agenciaNombre === "Matriz";
  // interés de mora (% del interés normal): el de la agencia; sin dato, el institucional de antes
  const relMora = interesMoraDe(parametrosOtrosPasivo) ?? metasCredito.relacion_mora ?? RELACION_MORA_INTERES_NORMAL;
  const captaciones = construirCaptaciones(saldos, paramsCaptaciones);

  const metaColocacionAgencia = calcularMetaColocacionAgencia(oficialesCredito, metasCredito);
  const lineasNombres: Linea[] = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"];
  const cumplimientoColocacion = cumplimientoColocacionDe(parametrosOtrosPasivo);
  const lineasCartera = lineasNombres.map((l) => construirLineaCartera(saldos, paramsCredito, l, metaColocacionAgencia, cumplimientoColocacion));

  const categoriasAF = CATEGORIAS_ACTIVO_FIJO_MATRIZ.map((cat) => ({
    ...cat,
    tasa_anual: factorParaCategoria(cat.nombre, factoresDepreciacion),
    costo_inicial: s(saldos, CODIGO_AF[cat.nombre]?.costo ?? ""),
    depreciacion_acumulada_inicial: -Math.abs(s(saldos, CODIGO_AF[cat.nombre]?.dep ?? "")),
  }));
  // Si la agencia tiene cargado el registro de activos fijos, la depreciación
  // de los bienes existentes sale bien por bien de ese registro; si no, se
  // calcula como antes (costo × factor ÷ 12). Ver lib/calc/activo-fijo.ts.
  const depRegistro = depreciacionRegistroDe(factoresDepreciacion);
  // Revalúos (Patrimonio → Otras cuentas): suben el costo del bien y la cuenta 35 el mismo mes,
  // sin mover efectivo. Sin datos guardados = 0 (no hay valor de referencia).
  const revaluoTerrenosPorMes = arrPorConcepto(parametrosOtrosPasivo, "patrimonio_revaluo_terrenos");
  const revaluoEdificiosPorMes = arrPorConcepto(parametrosOtrosPasivo, "patrimonio_revaluo_edificios");
  const donacionesEfectivoPorMes = arrPorConcepto(parametrosOtrosPasivo, "patrimonio_donaciones_efectivo");
  const resultadosAF = categoriasAF.map((cat) => {
    const compras = totalMensualPorConceptoExacto(filasPresupuesto, CODIGO_AF[cat.nombre]?.costo ?? "");
    const conRevaluo = cat.nombre === "Edificios" ? compras.map((v, i) => v + revaluoEdificiosPorMes[i]) : compras;
    return calcularActivoFijoCategoria(
      cat,
      conRevaluo,
      depRegistro ? depRegistro[cat.nombre] ?? Array(12).fill(0) : undefined
    );
  });
  const adquisicionesTerrenosPorMes = totalMensualPorConceptoExacto(filasPresupuesto, "1801");
  const terrenos = calcularTerrenos(s(saldos, "1801"), adquisicionesTerrenosPorMes.map((v, i) => v + revaluoTerrenosPorMes[i]));

  // 1904, 1905 y 1906 salen del registro de partidas (Otros activos): pagos (salen de fondos disponibles), gasto
  // devengado (4506 / 450705, no es efectivo) y saldo. Sin partidas registradas, el saldo del corte se mantiene.
  const dif = diferidosDe(saldos);
  const cero12 = () => Array(12).fill(0) as number[];
  // pagos de pólizas y diferidos + variación de los anticipos a terceros (190410): todo sale de caja (negativo, entra)
  const gastosAnticipadosEntradas = dif ? dif.grupos["1904"].pagosPorMes.map((v, i) => v + dif.grupos["1905"].pagosPorMes[i] + (dif.grupos["1904"].anticipos?.variacionPorMes[i] ?? 0)) : cero12();
  const gastosAnticipadosSalidas = dif ? dif.grupos["1904"].gastoPorMes.map((v, i) => v + dif.grupos["1905"].gastoPorMes[i]) : cero12();
  // Seguros y demás partidas con gasto en 4503: van como filas del presupuesto (Servicios varios) y no son efectivo
  const gastoDiferido4503 = cero12();
  if (dif) for (const g of ["1904", "1905"] as const) for (const [k, v] of Object.entries(dif.grupos[g].gastoPorCuenta)) if (k.startsWith("4503")) v.forEach((x, i) => { gastoDiferido4503[i] += x; });
  const amortizacion4506 = gastosAnticipadosSalidas.map((v, i) => v - gastoDiferido4503[i]);
  const materialesEntradas = dif ? [...dif.grupos["1906"].pagosPorMes] : cero12();
  // Pólizas (y demás partidas) pagadas en cuotas: entran completas al activo contra cuentas por pagar (25); la cuota inicial
  // sale de caja al contratar y las demás, mes a mes, por la 25
  const deudaAlta = (g: "1904" | "1905" | "1906") => (dif ? dif.grupos[g].deudaAltaPorMes ?? cero12() : cero12());
  const deudaPago = (g: "1904" | "1905" | "1906") => (dif ? dif.grupos[g].deudaPagoPorMes ?? cero12() : cero12());
  const polizasPorPagarAlta = cero12().map((_, i) => deudaAlta("1904")[i] + deudaAlta("1905")[i] + deudaAlta("1906")[i]);
  const polizasPorPagarPago = cero12().map((_, i) => deudaPago("1904")[i] + deudaPago("1905")[i] + deudaPago("1906")[i]);
  // lo que sale de caja: contado y cuota inicial + cuotas que se pagan en el mes
  const pagosAnticipadosCaja = gastosAnticipadosEntradas.map((v, i) => v - deudaAlta("1904")[i] - deudaAlta("1905")[i] + deudaPago("1904")[i] + deudaPago("1905")[i]);
  const materialesCaja = materialesEntradas.map((v, i) => v - deudaAlta("1906")[i] + deudaPago("1906")[i]);
  const materialesSalidas = dif ? [...dif.grupos["1906"].gastoPorMes] : cero12();
  // Materiales: lo que Matriz (bodega) entrega a las agencias baja su 1906 contra transferencias internas (1908), sin efectivo
  const plan1906 = dif?.grupos["1906"].plan;
  // Préstamos internos: lo que la agencia presta sube su 1908 (sale de caja) y lo que le abonan la baja (entra a caja);
  // lo que recibe prestado sube su 2908 (entra a caja) y lo que abona la baja (sale de caja)
  const pInt = prestamosInternosDe(saldos);
  const transferenciasOA1908Entradas = valorPorConceptoOFijo(parametrosOtrosPasivo, "transferencias_1908_entradas", INPUT_OTROS_ACTIVOS_MATRIZ.transferenciasInternas1908.entradasPorMes, esMatriz)
    .map((v, i) => v + (plan1906?.entregas[i] ?? 0) + (pInt?.otorgado[i] ?? 0));
  const transferenciasOA1908Salidas = valorPorConceptoOFijo(parametrosOtrosPasivo, "transferencias_1908_salidas", INPUT_OTROS_ACTIVOS_MATRIZ.transferenciasInternas1908.salidasPorMes, esMatriz)
    .map((v, i) => v + (pInt?.cobrado[i] ?? 0));
  // Fondo de Liquidez: cada agencia paga su propio aporte con el % vigente (el mismo para todas,
  // editable por agencia y mes). Sin valores guardados se usa el % por defecto, también en agencias.
  const pctVigentePorMes = parametrosOtrosPasivo.some((f) => f.concepto === "fondo_liquidez_pct_vigente")
    ? pctPorConcepto(parametrosOtrosPasivo, "fondo_liquidez_pct_vigente")
    : Array(12).fill(parametrosVigentesDe(saldos).fondo_liquidez_pct);
  const obligaciones21 = obligacionesPublicoProyectadas(saldos, captaciones.totalMensual);
  // Fondo de liquidez: el aporte o reintegro se calcula sobre los APORTES (19028601); los rendimientos del fideicomiso
  // (el resto de la 1902) no entran en esa cuenta. Sin el detalle en el balance, toda la 1902 se toma como aporte.
  const aportes1902 = saldos["19028601"] !== undefined ? Math.abs(Number(saldos["19028601"]) || 0) : s(saldos, "1902");
  const rendimientos1902 = s(saldos, "1902") - aportes1902;
  // rendimiento del fideicomiso del año (53040505): se capitaliza en la 1902 y no es efectivo
  const rendimientoFL = rendimientoFLDe(saldos)?.porMes ?? Array(12).fill(0) as number[];

  const otrosActivos = calcularOtrosActivosMatriz({
    saldoInicialInversiones1901: s(saldos, "1901"),
    fondoLiquidez: {
      pctVigentePorMes,
      metaPct: parametrosVigentesDe(saldos).fondo_liquidez_meta,
      saldoObligacionesPublicoDicAnterior: obligaciones21.corte,
      saldo1902DicAnterior: aportes1902,
      rendimientos1902,
      rendimientoPorMes: rendimientoFL,
      totalCaptacionesPorMes: obligaciones21.porMes,
    },
    gastosAnticipados1904: { saldoInicialEnero: suma(saldos, ["1904", "1905"]), entradasPorMes: gastosAnticipadosEntradas, salidasPorMes: gastosAnticipadosSalidas },
    materiales1906: { saldoInicialEnero: s(saldos, "1906"), entradasPorMes: materialesEntradas, salidasPorMes: materialesSalidas },
    transferenciasInternas1908: { saldoInicialEnero: s(saldos, "1908"), entradasPorMes: transferenciasOA1908Entradas, salidasPorMes: transferenciasOA1908Salidas },
    otrosFijo1990: s(saldos, "1990"),
    provisionFija1999: -Math.abs(s(saldos, "1999")),
  });

  // 25 = lo escrito a mano + las cuotas por pagar de las pólizas financiadas
  // (el Flujo sigue usando solo lo escrito a mano en la 25; las cuotas de pólizas salen de caja en "pagos anticipados")
  const cuentasPorPagarPagosManual = valorPorConceptoOFijo(parametrosOtrosPasivo, "cuentas_por_pagar_pagos", INPUT_PASIVO_MATRIZ.cuentasPorPagar.pagosPorMes, esMatriz);
  const cuentasPorPagarIncrementos = valorPorConceptoOFijo(parametrosOtrosPasivo, "cuentas_por_pagar_incrementos", INPUT_PASIVO_MATRIZ.cuentasPorPagar.incrementosPorMes, esMatriz).map((v, i) => v + polizasPorPagarAlta[i]);
  const cuentasPorPagarPagos = cuentasPorPagarPagosManual.map((v, i) => v + polizasPorPagarPago[i]);
  // Flujo: variación neta de lo escrito a mano en la 25 (incrementos − pagos). Un incremento es gasto que aún no se paga
  // (entra como fuente), un pago sale de caja. Antes el Flujo tomaba solo los pagos y con el signo al revés (como el Excel),
  // y la 25 bajaba sin que bajara la caja: el Balance descuadraba 2 × los pagos cada mes.
  const cuentasPorPagarIncrementosManual = cuentasPorPagarIncrementos.map((v, i) => v - polizasPorPagarAlta[i]);
  const cuentasPorPagarVariacionCaja = cuentasPorPagarIncrementosManual.map((v, i) => v - cuentasPorPagarPagosManual[i]);
  // Materiales: lo que la agencia recibe de Matriz sube su 1906 contra transferencias internas recibidas (2908), sin efectivo
  const transf2908Incrementos = valorPorConceptoOFijo(parametrosOtrosPasivo, "transferencias_2908_incrementos", INPUT_PASIVO_MATRIZ.transferenciasInternasRecibidas.incrementosPorMes, esMatriz)
    .map((v, i) => v + (plan1906?.pedidos[i] ?? 0) + (pInt?.recibido[i] ?? 0));
  const transf2908Disminuciones = valorPorConceptoOFijo(parametrosOtrosPasivo, "transferencias_2908_disminuciones", INPUT_PASIVO_MATRIZ.transferenciasInternasRecibidas.disminucionesPorMes, esMatriz)
    .map((v, i) => v + (pInt?.pagado[i] ?? 0));

  const pasivo = calcularPasivoMatriz({
    cuentasPorPagar: { saldoInicialEnero: s(saldos, "25"), incrementosPorMes: cuentasPorPagarIncrementos, pagosPorMes: cuentasPorPagarPagos },
    creditosExternos: INPUT_PASIVO_MATRIZ.creditosExternos,
    transferenciasInternasRecibidas: { saldoInicialEnero: s(saldos, "2908"), incrementosPorMes: transf2908Incrementos, disminucionesPorMes: transf2908Disminuciones },
    otrosFijo2990: s(saldos, "2990"),
  });

  const depreciacionMensualPorMes = Array.from({ length: 12 }, (_, i) =>
    resultadosAF.reduce((sum, r) => sum + r[i].depreciacion_del_mes, 0)
  );

  // Provisión de cartera: % inicial = el real del balance cargado; % de cada
  // mes y "sin reversiones" = Cartera → Parámetros → Provisión. El % que
  // resulta cada mes (ratioProvisionPorMes) es el que usan Balance, ER y Flujo.
  const parametrosProvision = parametrosProvisionDe(saldos);
  const provisionInfo = {} as Record<Linea, ResultadoProvisionLinea>;
  // Modelo por flow rates (tramos de mora): si la agencia tiene corte de Calificación de Cartera cargado,
  // reemplaza el cálculo por % y además resta los castigos de la cartera en riesgo (asiento real).
  const provisionFlow: ProvisionFlowAgencia | null = calcularProvisionFlowAgencia(saldos, lineasNombres, lineasCartera,
    (linea) => Math.abs(suma(saldos, CODIGOS_PROVISION_CARTERA[linea])), factorMoraDe(parametrosOtrosPasivo), supuestosMoraDe(paramsCredito, factorVencidaDe(saldos)));
  const provisionPorLinea: Record<Linea, ParametrosLineaProvision> = Object.fromEntries(
    lineasNombres.map((linea, idx) => {
      const resultado = lineasCartera[idx];
      const carteraTotalPorMes = Array.from(
        { length: 12 },
        (_, i) => resultado.porVencer[i].saldoFinal + resultado.enRiesgo[i].saldoFinal
      );
      const saldoInicialProvision = Math.abs(suma(saldos, CODIGOS_PROVISION_CARTERA[linea]));
      const info = calcularProvisionLinea({
        saldoInicial: saldoInicialProvision,
        carteraInicial: suma(saldos, CODIGOS_CARTERA[linea].porVencer) + suma(saldos, CODIGOS_CARTERA[linea].enRiesgo),
        carteraPorMes: carteraTotalPorMes,
        parametro: parametrosProvision[linea] ?? null,
        pctRespaldo: RATIO_PROVISION[linea],
      });
      provisionInfo[linea] = info;
      const flow = provisionFlow?.porLinea[linea];
      if (flow) {
        // 1499 de la línea = su saldo real del corte + lo que mueve el modelo (gasto − castigos);
        // la cartera ya viene sin los castigos acumulados.
        const ratio = carteraTotalPorMes.map((c, i) => (c ? flow.saldo1499[i] / c : 0));
        info.requeridaPorMes = [...flow.saldo1499];
        info.pctAplicadoPorMes = ratio;
        info.gastoPorMes = [...flow.gastoNeto];
        return [linea, { saldoInicialDicAnterior: -saldoInicialProvision, carteraTotalPorMes, ratioProvisionPorMes: ratio, castigosPorMes: [...flow.castigos], saldoPorMes: [...flow.saldo1499] }];
      }
      return [
        linea,
        {
          saldoInicialDicAnterior: -saldoInicialProvision,
          carteraTotalPorMes,
          ratioProvisionPorMes: info.pctAplicadoPorMes,
          saldoPorMes: [...info.requeridaPorMes],
        },
      ];
    })
  ) as Record<Linea, ParametrosLineaProvision>;

  const provisionGenerica = -Math.abs(s(saldos, CODIGO_PROVISION_GENERICA));
  // 149987 Provisiones no reversadas por requerimiento normativo (puede ser + o −) y lo que el total de la 14 tenga y sus
  // subcuentas no muestren (hay reportes donde la 1499 no es la suma de sus líneas): se mantienen con el saldo del corte.
  // Sin esto el Balance no arranca igual al real y descuadra por ese valor todo el año.
  const leidas14 = Object.values(CODIGOS_CARTERA).flatMap((l) => [...l.porVencer, ...l.enRiesgo])
    .reduce((t, c) => t + (Number(saldos[c]) || 0), 0)
    + [...Object.values(CODIGOS_PROVISION_CARTERA).flat(), CODIGO_PROVISION_GENERICA, "149987"].reduce((t, c) => t + (Number(saldos[c]) || 0), 0);
  const residuo14 = saldos["14"] !== undefined ? (Number(saldos["14"]) || 0) - leidas14 : 0;
  const provisionNoReversada = s(saldos, "149987") + (Math.abs(residuo14) >= 0.5 ? residuo14 : 0);

  // Con el modelo de flow rates, 5604.05 (recuperación de castigada) y 5604.10 (reversión) salen del modelo,
  // no del presupuesto departamental: se quitan de ahí para no contarlas dos veces.
  const externo = construirInputInstitucional(provisionFlow ? filasSinRecuperaciones(filasPresupuesto) : filasPresupuesto, empleados, agenciaNombre);
  if (provisionFlow) externo.otrosIngresosPorMes = externo.otrosIngresosPorMes.map((v, i) => v + provisionFlow.recuperacion[i]);

  // Contribuciones obligatorias (lib/calc/contribuciones): COSEDE mensual y SEPS (abril y septiembre).
  const contribuciones = calcularContribucionesAgencia(saldos, parametrosOtrosPasivo, obligaciones21);
  externo.aportesSEPSPorMes = [...contribuciones.seps.porMes];

  const ingresosEgresos = calcularIngresosEgresosMatriz({
    interesesCausados: {
      capitalizacionInteresVistaPorMes: captaciones.vista.map((r) => r.detalle.capitalizacionInteres),
      capitalizacionInteresCrecerPorMes: captaciones.crecer.map((r) => r.detalle.capitalizacionInteres),
      dpfSaldoInicialPorMes: captaciones.dpf.map((r) => r.saldoInicial),
      dpfSaldoFinalPorMes: captaciones.dpf.map((r) => r.saldoFinal),
      tasaDPFAnualPorMes: arr12(paramsCaptaciones.filter((f) => f.producto === "DPF"), "tasa_interes_anual"),
      interesesCreditosExternosPorMes: Array(12).fill(0),
    },
    provisionCartera: {
      productivo: provisionPorLinea.PRODUCTIVO,
      consumo: provisionPorLinea.CONSUMO,
      inmobiliario: provisionPorLinea.INMOBILIARIO,
      microcredito: provisionPorLinea.MICROCREDITO,
    },
    ingresoCartera: {
      ingresoPorInteresPorProducto: lineasCartera.map((r) => r.ingresoPorInteres),
      relacionMoraInteresNormal: relMora,
    },
    totalCaptacionesPorMes: captaciones.totalMensual,
    cosedeMensual: { fija: contribuciones.cosede.fija, par: contribuciones.cosede.par },
    depreciacionMensualPorMes,
    // Mismas salidas que usa el Balance (Otros activos → 1904 y 1906, editables y guardadas en la base).
    // Antes se usaban los valores fijos de referencia de Matriz: si se editaban en Otros activos, el
    // Balance bajaba el saldo pero el gasto (4506 / 450705) y el resultado no cambiaban (descuadre).
    amortizacionGastosAnticipadosPorMes: amortizacion4506,
    amortizacionMaterialesPorMes: materialesSalidas,
    externo,
  });

  const capitalSocialMontoAporte = valorPorConceptoOFijo(parametrosOtrosPasivo, "capital_social_monto_aporte", CONFIG_CAPITAL_SOCIAL_MATRIZ.monto_obligatorio_aporte_por_mes, esMatriz);
  const capitalSocialSociosNuevos = valorPorConceptoOFijo(parametrosOtrosPasivo, "capital_social_socios_nuevos", CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_nuevos_por_mes, esMatriz);
  const capitalSocialSociosRetirados = valorPorConceptoOFijo(parametrosOtrosPasivo, "capital_social_socios_retirados", CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_retirados_por_mes, esMatriz);
  const capitalSocialCapDividendos = valorPorConceptoOFijo(parametrosOtrosPasivo, "capital_social_capitalizacion_dividendos", CONFIG_CAPITAL_SOCIAL_MATRIZ.capitalizacion_dividendos_por_mes, esMatriz);
  const capitalSocialSociosInicialArr = valorPorConceptoOFijo(parametrosOtrosPasivo, "capital_social_socios_inicial", Array(12).fill(CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_inicial), esMatriz);

  // Devolución promedio por socio retirado: la guardada en Patrimonio -> Capital social o,
  // si no hay, la estimada = saldo de la cuenta 31 ÷ socios al inicio (lo aportado en promedio).
  const capitalSocialDevolucion = devolucionPromedioSocio(parametrosOtrosPasivo, s(saldos, "31"), capitalSocialSociosInicialArr[0], capitalSocialMontoAporte);

  const configCapitalSocial: ConfigCapitalSocial = {
    saldo_inicial: s(saldos, "31"),
    socios_inicial: capitalSocialSociosInicialArr[0],
    monto_obligatorio_aporte_por_mes: capitalSocialMontoAporte,
    socios_nuevos_por_mes: capitalSocialSociosNuevos,
    socios_retirados_por_mes: capitalSocialSociosRetirados,
    capitalizacion_dividendos_por_mes: capitalSocialCapDividendos,
    devolucion_promedio_por_mes: capitalSocialDevolucion,
  };
  const configPatrimonio = {
    capitalSocial: configCapitalSocial,
    saldoReservas33: s(saldos, "33"),
    saldoOtrosAportes34: s(saldos, "34"),
    saldoSuperavit35: s(saldos, "35"),
    resultadosAcumuladosIniciales36: s(saldos, "36"),
    movimientos34PorMes: donacionesEfectivoPorMes,
    movimientos35PorMes: revaluoTerrenosPorMes.map((v, i) => v + revaluoEdificiosPorMes[i]),
  };

  const patrimonio = calcularPatrimonioMatriz(ingresosEgresos.map((r) => r.resultado_del_ejercicio_acumulado), configPatrimonio);

  const depositosAhorroVistaPorMes = captaciones.vista.map((r) => r.detalle.depositos);
  const depositosAhorroCrecerPorMes = captaciones.crecer.map((r) => r.detalle.depositos);
  const renovacionesDPFPorMes = captaciones.dpf.map((r) => r.detalle.renovaciones);
  const recuperacionCarteraEfectivaPorMes = Array.from({ length: 12 }, (_, i) =>
    lineasCartera.reduce(
      (sum, r) => sum - r.porVencer[i].detalle.recuperacionPrestamos + r.enRiesgo[i].detalle.recuperacionRiesgo,
      0
    )
  );

  const interesesCarteraConMoraPorMes = Array.from({ length: 12 }, (_, i) => {
    const sinMora = lineasCartera.reduce((sum, r) => sum + r.ingresoPorInteres[i], 0);
    return sinMora * (1 + relMora);
  });

  const tasaDPFAnualPorMes = arr12(paramsCaptaciones.filter((f) => f.producto === "DPF"), "tasa_interes_anual");
  const interesesPagadosDPFPorMes = captaciones.dpf.map(
    (r, i) => ((r.saldoInicial + r.saldoFinal) / 2) * (tasaDPFAnualPorMes[i] / 12)
  );

  const cosedeFijaMensual = contribuciones.cosede.fija;
  const cosedeVariableMensual = contribuciones.cosede.par;

  const gastosOperacionalesEnEfectivoPorMes = Array.from({ length: 12 }, (_, i) =>
    externo.honorariosPorMes[i] +
    externo.serviciosVariosPorMes[i] +
    (externo.impuestosMunicipalesYOtrosPorMes[i] + cosedeFijaMensual[i] + cosedeVariableMensual[i]) +
    externo.otrosGastosOperInstitucionalPorMes[i] -
    gastoDiferido4503[i] // seguros devengados (4503) de gastos anticipados: se pagaron al contratar la póliza
  );

  const adquisicionActivosFijosPorMes = Array.from(
    { length: 12 },
    // Solo compras en efectivo: el revalúo de edificios sube el costo pero no sale dinero
    (_, i) => resultadosAF.reduce((sum, r) => sum + r[i].adquisicion_del_mes, 0) - revaluoEdificiosPorMes[i] + adquisicionesTerrenosPorMes[i]
  );

  // Antes esto leía un concepto separado ("aportes_socios_nuevos" /
  // "retiros_aporte_socios") que no tenía ninguna pantalla apuntándole -- por
  // eso Patrimonio nunca lo movía. Ahora se deriva directo de lo que sí
  // editas en Patrimonio (N° socios nuevos/retirados × Monto obligatorio de
  // aporte), igual fórmula que ya usa el rollforward de la cuenta 31.
  const aportesSociosPorMes = Array.from({ length: 12 }, (_, i) => capitalSocialSociosNuevos[i] * capitalSocialMontoAporte[i]);
  const retirosAporteSociosPorMes = Array.from({ length: 12 }, (_, i) => capitalSocialSociosRetirados[i] * capitalSocialDevolucion[i]);
  // CUENTAS POR COBRAR (16), igual que el Excel (Agencia_Modelo, fila 149): relación fija del balance de
  // partida = saldo de la 16 ÷ cartera por vencer; cada mes, saldo final = relación × cartera por vencer
  // proyectada. No se edita. La 1602 (intereses por cobrar de inversiones) queda fuera de la relación:
  // la mueve el registro de Inversiones (extra16), así no se cuenta dos veces.
  const cxcCodigo1602 = s(saldos, "1602");
  const cxcBase = s(saldos, "16") - cxcCodigo1602;
  const cxcCarteraPorVencerCorte = lineasCartera.reduce((t, r) => t + r.porVencer[0].saldoInicial, 0);
  const cxcCarteraPorVencerPorMes = Array.from({ length: 12 }, (_, i) => lineasCartera.reduce((t, r) => t + r.porVencer[i].saldoFinal, 0));
  const cxcRelacion = cxcCarteraPorVencerCorte ? cxcBase / cxcCarteraPorVencerCorte : 0;
  const cxcSaldoFinalPorMes = cxcCarteraPorVencerPorMes.map((pv) => cxcRelacion * pv);
  const cuentasPorCobrarVariacionPorMes = cxcSaldoFinalPorMes.map((v, i) => v - (i === 0 ? cxcBase : cxcSaldoFinalPorMes[i - 1]));

  const montoPrestamosAConcederPorMes = Array.from({ length: 12 }, (_, i) =>
    lineasCartera.reduce((sum, r) => sum + r.porVencer[i].detalle.prestamosAConceder, 0)
  );

  // Insumos individuales del Flujo de Efectivo, nombrados aparte para poder
  // exponerlos tal cual en insumosFlujoEfectivo (pantalla de detalle) sin
  // duplicar la lógica de cada línea.
  const interesesGanadosDepInvPorMes = externo.depositosEInversionesPorMes;
  const transferenciasInternasRecibidasFlujoPorMes = Array.from({ length: 12 }, (_, i) => transf2908Incrementos[i] + transferenciasOA1908Salidas[i]);
  const otrosIngresosTotalPorMes = Array.from(
    { length: 12 },
    // el rendimiento del Fondo de liquidez (53040505) se capitaliza en la 1902: no entra a caja
    (_, i) => externo.utilidadesFinancierasPorMes[i] + externo.otrosIngresosOperacionalesPorMes[i] + externo.otrosIngresosPorMes[i] + externo.otrosIngresosAdicionalesPorMes[i] - (rendimientoFL[i] ?? 0)
  );
  const retirosAhorroVistaPorMes = captaciones.vista.map((r) => r.detalle.retiros);
  const retirosAhorroCrecerPorMes = captaciones.crecer.map((r) => r.detalle.retiros);
  const cancelacionesDPFPorMes = captaciones.dpf.map((r) => r.detalle.cancelaciones);
  const transferenciasInternasDevueltasPorMes = Array.from({ length: 12 }, (_, i) => transf2908Disminuciones[i] + transferenciasOA1908Entradas[i]);
  const ajusteFondoLiquidezPorMes = otrosActivos.map((r) => r.ajuste_fondo_liquidez);
  // Gastos del presupuesto que sí salen de caja y antes no pasaban por el Flujo (descuadraban el Balance):
  // aportes SEPS (450415), comisiones causadas (42), otros gastos y pérdidas (47), participación e impuesto a la renta (48).
  // Se pagan en el mismo mes en que están presupuestados.
  const otrosEgresosEnEfectivoPorMes = Array.from({ length: 12 }, (_, i) =>
    externo.aportesSEPSPorMes[i] + externo.comisionesCausadasPorMes[i] + externo.otrosGastosYPerdidasPorMes[i] + externo.participacionEmpleadosEImpuestoRentaPorMes[i] +
    externo.otrosEgresosAdicionalesPorMes[i]);

  const flujoEfectivo = calcularFlujoEfectivoMatriz({
    saldoInicialCajaEnero: suma(saldos, ["11", "13"]),
    depositosAhorroVistaPorMes: depositosAhorroVistaPorMes,
    depositosAhorroCrecerPorMes: depositosAhorroCrecerPorMes,
    renovacionesDPFPorMes,
    interesesGanadosDepInvPorMes,
    // Fuente "aportes": aportes de socios nuevos + donaciones en efectivo (34); en el detalle del Flujo van en filas separadas
    aportesSociosPorMes: aportesSociosPorMes.map((v, i) => v + donacionesEfectivoPorMes[i]),
    recuperacionCarteraEfectivaPorMes,
    interesesCarteraConMoraPorMes,
    comisionesGanadasCarteraPorMes: externo.comisionesGanadasCarteraPorMes,
    cuentasPorCobrarVariacionPorMes,
    creditosExternosNuevosPorMes: Array(12).fill(0),
    transferenciasInternasRecibidasPorMes: transferenciasInternasRecibidasFlujoPorMes,
    ingresosPorServiciosPorMes: externo.ingresosPorServiciosPorMes,
    otrosIngresosTotalPorMes,
    retirosAhorroVistaPorMes,
    retirosAhorroCrecerPorMes,
    cancelacionesDPFPorMes,
    retirosAporteSociosPorMes,
    interesesPagadosDPFPorMes,
    interesesPagadosCreditosExternosPorMes: Array(12).fill(0),
    gastosDePersonalPorMes: externo.gastosPersonalPorMes,
    gastosOperacionalesEnEfectivoPorMes,
    adquisicionActivosFijosPorMes,
    pagoCreditosExternosPorMes: Array(12).fill(0),
    cuentasPorPagarPagosPorMes: cuentasPorPagarVariacionCaja,
    transferenciasInternasDevueltasPorMes,
    nuevasInversionesPorMes: Array(12).fill(0),
    nuevosPagosAnticipadosPorMes: pagosAnticipadosCaja,
    nuevasAdquisicionesMaterialesPorMes: materialesCaja,
    ajusteFondoLiquidezPorMes,
    otrosEgresosEnEfectivoPorMes,
    totalCaptacionesPorMes: captaciones.totalMensual,
    pctEncaje: pctEncajeDe(saldos),
    montoPrestamosAConcederPorMes,
  });

  return {
    // Variación acumulada de la 16 frente al balance de partida (la descuenta el Flujo; la suma el Balance)
    cxcVariacionAcumulada: cxcSaldoFinalPorMes.map((v) => v - cxcBase),
    captaciones,
    lineasCartera,
    lineasNombres,
    resultadosAF,
    categoriasAF,
    terrenos,
    otrosActivos,
    pasivo,
    ingresosEgresos,
    patrimonio,
    flujoEfectivo,
    provisionPorLinea,
    provisionInfo,
    provisionGenerica,
    provisionNoReversada,
    provisionFlow,
    contribuciones,
    relacionMoraInteresNormal: relMora,
    insumosOtrosActivos: {
      saldoInicialInversiones1901: s(saldos, "1901"),
      pctVigentePorMes,
      pctGuardado: parametrosOtrosPasivo.some((f) => f.concepto === "fondo_liquidez_pct_vigente"),
      saldoObligacionesPublicoDicAnterior: obligaciones21.corte,
      saldo1902DicAnterior: aportes1902,
      rendimientos1902,
      rendimientoFL,
      totalCaptacionesPorMes: obligaciones21.porMes,
      obligacionesCaptacionesCorte: obligaciones21.captacionesCorte,
      obligacionesOtras21: obligaciones21.otras,
      gastosAnticipadosSaldoInicial: suma(saldos, ["1904", "1905"]),
      gastosAnticipadosEntradas,
      gastosAnticipadosSalidas,
      materialesSaldoInicial: s(saldos, "1906"),
      materialesEntradas,
      materialesSalidas,
      transferencias1908SaldoInicial: s(saldos, "1908"),
      transferenciasOA1908Entradas,
      transferenciasOA1908Salidas,
    },
    insumosPasivo: {
      cuentasPorPagarSaldoInicial: s(saldos, "25"),
      cuentasPorPagarIncrementos,
      cuentasPorPagarPagos,
      polizasPorPagarAlta,
      polizasPorPagarPago,
      creditosExternos: INPUT_PASIVO_MATRIZ.creditosExternos,
      transferencias2908SaldoInicial: s(saldos, "2908"),
      transf2908Incrementos,
      transf2908Disminuciones,
    },
    insumosPatrimonioYCxc: {
      aportesSociosPorMes,
      retirosAporteSociosPorMes,
      cuentasPorCobrarSaldoInicial: cxcBase,
      cuentasPorCobrarVariacionPorMes,
      cuentasPorCobrarInfo: { base16: cxcBase, c1602: cxcCodigo1602, carteraPorVencerCorte: cxcCarteraPorVencerCorte, carteraPorVencerPorMes: cxcCarteraPorVencerPorMes },
      configCapitalSocial,
      saldoReservas33: configPatrimonio.saldoReservas33,
      saldoOtrosAportes34: configPatrimonio.saldoOtrosAportes34,
      saldoSuperavit35: configPatrimonio.saldoSuperavit35,
      donacionesEfectivoPorMes,
      revaluoTerrenosPorMes,
      revaluoEdificiosPorMes,
    },
    insumosFlujoEfectivo: {
      donacionesEfectivoPorMes,
      depositosAhorroVistaPorMes,
      depositosAhorroCrecerPorMes,
      renovacionesDPFPorMes,
      interesesGanadosDepInvPorMes,
      aportesSociosPorMes,
      recuperacionCarteraEfectivaPorMes,
      interesesCarteraConMoraPorMes,
      comisionesGanadasCarteraPorMes: externo.comisionesGanadasCarteraPorMes,
      cuentasPorCobrarVariacionPorMes,
      creditosExternosNuevosPorMes: Array(12).fill(0) as number[],
      transferenciasInternasRecibidasPorMes: transferenciasInternasRecibidasFlujoPorMes,
      ingresosPorServiciosPorMes: externo.ingresosPorServiciosPorMes,
      otrosIngresosTotalPorMes,
      retirosAhorroVistaPorMes,
      retirosAhorroCrecerPorMes,
      cancelacionesDPFPorMes,
      retirosAporteSociosPorMes,
      interesesPagadosDPFPorMes,
      interesesPagadosCreditosExternosPorMes: Array(12).fill(0) as number[],
      gastosDePersonalPorMes: externo.gastosPersonalPorMes,
      gastosOperacionalesEnEfectivoPorMes,
      // Desglose de los gastos operativos en efectivo (Flujo por cuenta)
      gastosHonorariosPorMes: externo.honorariosPorMes,
      // en efectivo: sin los seguros devengados de gastos anticipados (4503), que se pagaron al contratar la póliza
      gastosServiciosVariosPorMes: externo.serviciosVariosPorMes.map((v, i) => v - gastoDiferido4503[i]),
      // gastos del presupuesto que no tienen otra línea (41059005 interés de préstamos internos, 43, 46, 4508…): salen de caja
      otrosEgresosAdicionalesPorMes: externo.otrosEgresosAdicionalesPorMes,
      gastosImpuestosYCosedePorMes: Array.from({ length: 12 }, (_, i) => externo.impuestosMunicipalesYOtrosPorMes[i] + cosedeFijaMensual[i] + cosedeVariableMensual[i]),
      gastosOtrosInstitucionalPorMes: externo.otrosGastosOperInstitucionalPorMes,
      adquisicionActivosFijosPorMes,
      pagoCreditosExternosPorMes: Array(12).fill(0) as number[],
      cuentasPorPagarPagosPorMes: cuentasPorPagarVariacionCaja,
      transferenciasInternasDevueltasPorMes,
      nuevasInversionesPorMes: Array(12).fill(0) as number[],
      nuevosPagosAnticipadosPorMes: pagosAnticipadosCaja,
      nuevasAdquisicionesMaterialesPorMes: materialesCaja,
      ajusteFondoLiquidezPorMes,
      otrosEgresosEnEfectivoPorMes,
      aportesSEPSPorMes: externo.aportesSEPSPorMes,
      comisionesCausadasPorMes: externo.comisionesCausadasPorMes,
      otrosGastosYPerdidasPorMes: externo.otrosGastosYPerdidasPorMes,
      participacionEImpuestoRentaPorMes: externo.participacionEmpleadosEImpuestoRentaPorMes,
    },
  };
}

interface ResultadoMesResumen {
  mes: number;
  totalActivo: number;
  totalPasivo: number;
  totalPatrimonio: number;
  totalCaptaciones: number;
  saldoCaja: number;
  resultadoAcumulado: number;
}

export function calcularProyeccionMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): ResultadoMesResumen[] {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);

  const resultados: ResultadoMesResumen[] = [];
  for (let i = 0; i < 12; i++) {
    const totalCarteraNeto = m.lineasCartera.reduce(
      (sum, r) => sum + r.porVencer[i].saldoFinal + r.enRiesgo[i].saldoFinal,
      0
    );
    const totalProvisionCartera = m.lineasNombres.reduce(
      (sum, linea) =>
        sum +
        saldoProvisionMes(m.provisionPorLinea[linea], i),
      0
    );
    const totalActivoFijo =
      m.resultadosAF.reduce((sum, r) => sum + r[i].valor_neto_en_libros, 0) + m.terrenos[i].costo_fin_mes;

    const totalActivo =
      m.flujoEfectivo[i].saldo_final +
      totalCarteraNeto -
      Math.abs(totalProvisionCartera) +
      m.provisionGenerica + m.provisionNoReversada +
      totalActivoFijo +
      m.otrosActivos[i].total +
      suma(saldos, ["16", "17"]) + m.cxcVariacionAcumulada[i];

    const totalPasivo = m.captaciones.totalMensual[i] + obligacionesPublicoProyectadas(saldos, m.captaciones.totalMensual).otras + m.pasivo[i].total;
    const totalPatrimonio = m.patrimonio[i].total_patrimonio;

    resultados.push({
      mes: i + 1,
      totalActivo,
      totalPasivo,
      totalPatrimonio,
      totalCaptaciones: m.captaciones.totalMensual[i],
      saldoCaja: m.flujoEfectivo[i].saldo_final,
      resultadoAcumulado: m.ingresosEgresos[i].resultado_del_ejercicio_acumulado,
    });
  }
  return resultados;
}

export interface NodoBalance {
  codigo: string;
  label: string;
  valores: number[];
  hijos?: NodoBalance[];
  cuentas?: string[];
}

const NOMBRES_LINEA: Record<Linea, string> = {
  PRODUCTIVO: "Productivo",
  CONSUMO: "Consumo",
  INMOBILIARIO: "Inmobiliario",
  MICROCREDITO: "Microcrédito",
};

/**
 * Liquidez requerida por producto de captaciones: saldo final del mes × % de liquidez requerida
 * parametrizado en Obligaciones con el público. NO es el encaje del BCE (3,5 % del Flujo).
 */
function liquidezRequeridaProductos(
  captaciones: { vista: { saldoFinal: number }[]; crecer: { saldoFinal: number }[]; dpf: { saldoFinal: number }[] },
  params: FilaParametroCaptaciones[],
): { vista: number[]; crecer: number[]; dpf: number[]; total: number[] } {
  const pctDe = (producto: Producto) => arr12(params.filter((f) => f.producto === producto), "pct_liquidez").map((v) => Number(v) || 0);
  const pv = pctDe("VISTA"), pc = pctDe("CRECER"), pd = pctDe("DPF");
  const vista = captaciones.vista.map((r, i) => r.saldoFinal * pv[i]);
  const crecer = captaciones.crecer.map((r, i) => r.saldoFinal * pc[i]);
  const dpf = captaciones.dpf.map((r, i) => r.saldoFinal * pd[i]);
  return { vista, crecer, dpf, total: vista.map((v, i) => v + crecer[i] + dpf[i]) };
}

/** Nombres de las subcuentas de Fondos disponibles (catálogo SEPS). */
const NOMBRES_11: Record<string, string> = {
  "1101": "Caja",
  "1102": "Depósitos para encaje",
  "1103": "Bancos y otras instituciones financieras",
  "1104": "Efectos de cobro inmediato",
  "1105": "Remesas en tránsito",
};

interface Cuenta11 { codigo: string; nombre: string; saldoCorte: number; regla: "caja" | "encaje" | "fija" | "resto"; valores: number[] }

/**
 * Reparto de la liquidez total del Flujo (11 + 13) en las subcuentas de la 11 y la 13.
 * Con inversiones registradas: 13 = capital de los títulos; el interés devengado por cobrar
 * y la retención cambian la 16 (extra16); fondos disponibles (11) = total − 13 − extra16.
 * Sin registro: la 13 conserva su proporción del balance de partida.
 * Los fondos disponibles se reparten POR REGLAS (lib/calc/fondos.ts): Caja = saldo del corte sin pasar
 * el límite de la agencia (cajeros + caja fuerte); las demás subcuentas mantienen su saldo del corte;
 * la 1103 (Bancos) recibe el resto, así el total 11 siempre cuadra. Lo usan el Balance, Fondos disponibles y la 5101 (interés de
 * bancos, que se calcula SOLO sobre la 1103), para que den lo mismo.
 */
export function repartoLiquidez(saldos: SaldosPorCodigo, saldoFinal: number[], encaje: number[] = saldoFinal.map(() => 0)): {
  caja: number[]; bancos: number[]; inversiones: number[]; extra16: number[]; fondos: number[]; cuentas11: Cuenta11[];
} {
  const total11 = saldos["11"] ?? 0;
  const total13 = saldos["13"] ?? 0;
  const total = total11 + total13;
  const inv = inversionesDe(saldos);
  const extra16 = saldoFinal.map((_, i) => (inv ? inv.variacion16PorMes[i] : 0));
  const inversiones = inv ? [...inv.capitalPorMes] : saldoFinal.map((v) => (total ? v * total13 / total : 0));
  const fondos = saldoFinal.map((v, i) => v - inversiones[i] - extra16[i]);

  // Subcuentas de 4 dígitos de la 11 con saldo al corte; la 1103 recibe el resto
  const codigos = Object.keys(saldos).filter((c) => /^11\d\d$/.test(c) && c !== "1103" && Math.abs(saldos[c] || 0) >= 0.005).sort();
  const sumaOtras = codigos.reduce((t, c) => t + (saldos[c] || 0), 0);
  const filas: { codigo: string; saldo: number }[] = [
    ...codigos.map((c) => ({ codigo: c, saldo: saldos[c] || 0 })),
    { codigo: "1103", saldo: total11 - sumaOtras },
  ].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const reparto = repartirFondosPorReglas(fondos, filas, limiteCaja(parametrosFondosDe(saldos)), encaje);
  const cuentas11: Cuenta11[] = reparto.map((r) => ({
    codigo: r.codigo, nombre: NOMBRES_11[r.codigo] ?? `Cuenta ${r.codigo}`, saldoCorte: r.saldoCorte, regla: r.regla, valores: r.valores,
  }));
  const de = (c: string) => cuentas11.find((x) => x.codigo === c)?.valores ?? saldoFinal.map(() => 0);
  return { caja: de("1101"), bancos: de("1103"), inversiones, extra16, fondos, cuentas11 };
}

/**
 * Fondos disponibles (11): liquidez total del Flujo repartida igual que en el Balance.
 * Saldo inicial = balance de partida; meses = saldo final del Flujo de efectivo.
 */
export function calcularFondosDisponiblesMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
) {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const saldoFinal = m.flujoEfectivo.map((f) => f.saldo_final);
  const liq = repartoLiquidez(saldos, saldoFinal, m.flujoEfectivo.map((f) => f.reservas_de_liquidez_requeridas));
  const inv = inversionesDe(saldos);
  const pf = parametrosFondosDe(saldos);
  // Pagos operativos del mes (lo que sale de bancos): personal + gastos operativos en efectivo + intereses pagados
  const fe = m.insumosFlujoEfectivo;
  const pagosMes = Array.from({ length: 12 }, (_, i) =>
    Math.abs(fe.gastosDePersonalPorMes[i] || 0) + Math.abs(fe.gastosOperacionalesEnEfectivoPorMes[i] || 0)
    + Math.abs(fe.interesesPagadosDPFPorMes[i] || 0) + Math.abs(fe.interesesPagadosCreditosExternosPorMes[i] || 0));
  // Tasa promedio de las inversiones vigentes al corte (ponderada por monto)
  const vigentes = inv ? inv.titulos.filter((t) => !t.planificada && t.monto > 0) : [];
  const montoVig = vigentes.reduce((t, x) => t + x.monto, 0);
  const tasaInversiones = montoVig > 0 ? vigentes.reduce((t, x) => t + x.monto * x.tasaAnual, 0) / montoVig : null;
  const requeridos = calcularFondosRequeridos({
    fondos: liq.fondos, reparto: liq.cuentas11, encaje: m.flujoEfectivo.map((f) => f.reservas_de_liquidez_requeridas),
    pagosMes, parametros: pf, ejercicio: pf?.ejercicio ?? 2027,
    saldoBancosCorte: liq.cuentas11.find((c) => c.codigo === "1103")?.saldoCorte ?? 0, tasaInversiones,
  });
  return {
    requeridos,
    parametrosFondos: pf ? { maxCajero: pf.maxCajero, maxCajaFuerte: pf.maxCajaFuerte, diasCobertura: pf.diasCobertura, guardado: pf.guardado } : null,
    pctEncaje: pctEncajeDe(saldos),
    captaciones: m.captaciones.totalMensual,
    captacionesCorte: saldos["21"] ?? null,
    saldoInicialFlujo: m.flujoEfectivo[0]?.saldo_inicial ?? 0,
    saldoFinalFlujo: saldoFinal,
    liquidezRequerida: liquidezRequeridaProductos(m.captaciones, paramsCaptaciones).total,
    encajeBCE: m.flujoEfectivo.map((f) => f.reservas_de_liquidez_requeridas),
    corte: { total11: saldos["11"] ?? 0, total13: saldos["13"] ?? 0, saldo1103: saldos["1103"] ?? null, total12: saldos["12"] ?? 0 },
    inversiones: liq.inversiones,
    extra16: liq.extra16,
    fondos: liq.fondos,
    cuentas11: liq.cuentas11,
    conRegistroInversiones: !!inv,
    titulosAlCorte: inv ? inv.capitalAlCorte : null,
  };
}

/**
 * 21 con los códigos del balance: 2101 → 210135 → ahorro a la vista (21013505 + 21013510 + 21013535, una fila Σ porque el motor
 * los proyecta juntos) y Crecer (21013515); 2103 DPF. Las demás cuentas de la 21 (solidarias, otros depósitos, por confirmar,
 * restringidos…) se mantienen con su saldo del corte en su propio código. Si el balance no trae los niveles intermedios, se
 * usa la forma anterior (vista, Crecer, DPF y otros depósitos), así el total siempre cuadra con el corte.
 */
function arbol21(saldos: SaldosPorCodigo, cap: { vista: { saldoFinal: number }[]; crecer: { saldoFinal: number }[]; dpf: { saldoFinal: number }[] }, otros21: number): NodoBalance[] {
  const VISTA = ["21013505", "21013510", "21013535"];
  const vista = cap.vista.map((r) => r.saldoFinal), crecer = cap.crecer.map((r) => r.saldoFinal), dpf = cap.dpf.map((r) => r.saldoFinal);
  const plano: NodoBalance[] = [
    { codigo: "", label: "Ahorro a la vista", valores: vista, cuentas: VISTA },
    { codigo: "21013515", label: "Ahorro crecer", valores: crecer },
    { codigo: "2103", label: "Depósitos a plazo", valores: dpf },
    ...(Math.abs(otros21) >= 0.5 ? [{ codigo: "", label: "Otros depósitos (saldo del corte)", valores: Array(12).fill(otros21) }] : []),
  ];
  const v = (c: string) => Number(saldos[c]) || 0;
  const hijosDe = (c: string, largo: number) => Object.keys(saldos).filter((k) => k.length === largo && k.startsWith(c) && Math.abs(v(k)) >= 0.005).sort();
  const fijo = (c: string): NodoBalance => ({ codigo: c, label: c, valores: Array(12).fill(v(c)) });
  if (saldos["2101"] === undefined || saldos["210135"] === undefined) return plano;
  const otros210135 = hijosDe("210135", 8).filter((k) => !VISTA.includes(k) && k !== "21013515").map(fijo);
  const n210135: NodoBalance = { codigo: "210135", label: "Depósitos de ahorro", valores: vista.map((x, i) => x + crecer[i] + otros210135.reduce((t, n) => t + n.valores[i], 0)), hijos: [
    { codigo: "", label: "Ahorro a la vista", valores: vista, cuentas: VISTA }, { codigo: "21013515", label: "Ahorro crecer", valores: crecer }, ...otros210135] };
  const otros2101 = hijosDe("2101", 6).filter((k) => k !== "210135").map(fijo);
  const n2101: NodoBalance = { codigo: "2101", label: "Depósitos a la vista", valores: n210135.valores.map((x, i) => x + otros2101.reduce((t, n) => t + n.valores[i], 0)), hijos: [n210135, ...otros2101] };
  const otros21n = hijosDe("21", 4).filter((k) => k !== "2101" && k !== "2103").map(fijo);
  // las cuentas fijas deben sumar lo mismo que «otros depósitos» del motor; si no, el balance no trae los niveles completos
  const fijos = [...otros210135, ...otros2101, ...otros21n].reduce((t, n) => t + n.valores[0], 0);
  if (Math.abs(fijos - otros21) >= 0.5) return plano;
  return [n2101, { codigo: "2103", label: "Depósitos a plazo", valores: dpf }, ...otros21n];
}

export function calcularBalanceGeneralMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): { activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance } {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const meses12 = (fn: (i: number) => number) => Array.from({ length: 12 }, (_, i) => fn(i));

  const liq = repartoLiquidez(saldos, m.flujoEfectivo.map((f) => f.saldo_final), m.flujoEfectivo.map((f) => f.reservas_de_liquidez_requeridas));
  const inv = inversionesDe(saldos);
  const extra16 = liq.extra16;
  // 11 Fondos disponibles como grupo de 2 dígitos (igual que 13, 14…) con sus subcuentas dentro
  const nodosLiquidez: NodoBalance[] = [
    { codigo: "11", label: "Fondos disponibles", valores: liq.fondos,
      hijos: liq.cuentas11.map((c) => ({ codigo: c.codigo, label: c.codigo === "1103" ? "Bancos" : c.nombre, valores: c.valores })) },
    // Siempre como grupo 13 (con o sin registro de títulos): así el Consolidado suma las 10 agencias en la misma fila
    { codigo: "13", label: "Inversiones", valores: liq.inversiones,
      hijos: inv ? Object.entries(inv.porCuenta).map(([codigo, c]) => ({ codigo, label: c.nombre || codigo, valores: c.valores })) : [] },
  ];

  const hijosPorVencer: NodoBalance[] = m.lineasNombres.map((linea, idx) => ({
    codigo: "",
    label: NOMBRES_LINEA[linea],
    valores: meses12((i) => m.lineasCartera[idx].porVencer[i].saldoFinal),
    cuentas: CODIGOS_CARTERA[linea].porVencer,
  }));
  const totalPorVencer = meses12((i) => hijosPorVencer.reduce((sum, h) => sum + h.valores[i], 0));

  const hijosEnRiesgo: NodoBalance[] = m.lineasNombres.map((linea, idx) => ({
    codigo: "",
    label: NOMBRES_LINEA[linea],
    valores: meses12((i) => m.lineasCartera[idx].enRiesgo[i].saldoFinal),
    cuentas: CODIGOS_CARTERA[linea].enRiesgo,
  }));
  const totalEnRiesgo = meses12((i) => hijosEnRiesgo.reduce((sum, h) => sum + h.valores[i], 0));

  const hijosProvision: NodoBalance[] = [
    { codigo: "149980", label: "Provisión genérica", valores: Array(12).fill(m.provisionGenerica) },
    ...(Math.abs(m.provisionNoReversada) >= 0.5 ? [{ codigo: "149987", label: "Provisiones no reversadas y otras del corte", valores: Array(12).fill(m.provisionNoReversada) }] : []),
    ...m.lineasNombres.map((linea) => ({
      codigo: "",
      label: `Crédito ${NOMBRES_LINEA[linea]}`,
      valores: meses12(
        (i) => -saldoProvisionMes(m.provisionPorLinea[linea], i)
      ),
      cuentas: CODIGOS_PROVISION_CARTERA[linea],
    })),
  ];
  const totalProvision = meses12((i) => hijosProvision.reduce((sum, h) => sum + h.valores[i], 0));

  const hijosCartera: NodoBalance[] = [
    { codigo: "", label: "Cartera por Vencer", valores: totalPorVencer, hijos: hijosPorVencer,
      cuentas: m.lineasNombres.flatMap((l) => CODIGOS_CARTERA[l].porVencer) },
    { codigo: "", label: "Cartera en Riesgo", valores: totalEnRiesgo, hijos: hijosEnRiesgo,
      cuentas: m.lineasNombres.flatMap((l) => CODIGOS_CARTERA[l].enRiesgo) },
    { codigo: "1499", label: "Provisión Créditos Incobrables", valores: totalProvision, hijos: hijosProvision },
  ];

  const totalCartera = meses12((i) => hijosCartera.reduce((sum, h) => sum + h.valores[i], 0));

  const totalActivoFijo = meses12(
    (i) => m.resultadosAF.reduce((sum, r) => sum + r[i].valor_neto_en_libros, 0) + m.terrenos[i].costo_fin_mes
  );

  // Desglose de Activo Fijo igual que el balance real: arriba el costo de cada
  // categoría (incluye Terrenos, que no se deprecia), abajo un solo bloque de
  // Depreciación acumulada con su propio desglose por categoría. El total de
  // "18" sigue siendo el neto (costo - depreciación), sin cambiar ningún cálculo.
  // cada bien con su cuenta contable (muebles, equipos y enseres de oficina van en 180505 y su depreciación en 189915)
  const hijosCostoAF: NodoBalance[] = anidarPorCodigo("18", [
    { codigo: "1801", label: "Terrenos", valores: meses12((i) => m.terrenos[i].costo_fin_mes) },
    ...m.categoriasAF.map((cat, idx) => ({
      codigo: CODIGO_AF[cat.nombre]?.costo ?? cat.codigo,
      label: cat.nombre,
      valores: meses12((i) => m.resultadosAF[idx][i].costo_fin_mes),
    })),
  ]);
  const hijosDepreciacionAF: NodoBalance[] = anidarPorCodigo("1899", m.categoriasAF.map((cat, idx) => ({
    codigo: CODIGO_AF[cat.nombre]?.dep ?? cat.codigo,
    label: cat.nombre,
    valores: meses12((i) => m.resultadosAF[idx][i].depreciacion_acumulada),
  })));
  const totalDepreciacionAF = meses12((i) => hijosDepreciacionAF.reduce((sum, h) => sum + h.valores[i], 0));
  const nodoDepreciacionAF: NodoBalance = {
    codigo: "1899",
    label: "(Depreciación acumulada)",
    valores: totalDepreciacionAF,
    hijos: hijosDepreciacionAF,
  };

  const activo: NodoBalance = {
    codigo: "1",
    label: "ACTIVO",
    valores: meses12(
      (i) =>
        m.flujoEfectivo[i].saldo_final +
        totalCartera[i] +
        suma(saldos, ["16", "17"]) + m.cxcVariacionAcumulada[i] +
        totalActivoFijo[i] +
        m.otrosActivos[i].total
    ),
    hijos: [
      ...nodosLiquidez,
      { codigo: "14", label: "Cartera de créditos", valores: totalCartera, hijos: hijosCartera },
      { codigo: "16", label: "Cuentas por cobrar", valores: meses12((i) => suma(saldos, ["16"]) + m.cxcVariacionAcumulada[i] + extra16[i]) },
      { codigo: "17", label: "Bienes realizables", valores: Array(12).fill(suma(saldos, ["17"])) },
      { codigo: "18", label: "Activo fijo", valores: totalActivoFijo, hijos: [...hijosCostoAF, nodoDepreciacionAF] },
      { codigo: "19", label: "Otros activos", valores: meses12((i) => m.otrosActivos[i].total), hijos: [
        { codigo: "1901", label: "Inversiones en acciones", valores: meses12((i) => m.otrosActivos[i].inversiones_1901) },
        { codigo: "1902", label: "Derechos fiduciarios", valores: meses12((i) => m.otrosActivos[i].derechos_fiduciarios_1902) },
        ...(diferidosDe(saldos) ? [
          { codigo: "1904", label: "Gastos y pagos anticipados", valores: [...diferidosDe(saldos)!.grupos["1904"].saldoPorMes] },
          { codigo: "1905", label: "Gastos diferidos", valores: [...diferidosDe(saldos)!.grupos["1905"].saldoPorMes] },
        ] : [{ codigo: "1904+1905", label: "Gastos y pagos anticipados", valores: meses12((i) => m.otrosActivos[i].gastos_anticipados_1904) }]),
        { codigo: "1906", label: "Materiales, mercaderías e insumos", valores: meses12((i) => m.otrosActivos[i].materiales_1906) },
        { codigo: "1908", label: "Transferencias internas", valores: meses12((i) => m.otrosActivos[i].transferencias_internas_1908) },
        { codigo: "1990", label: "Otros", valores: meses12((i) => m.otrosActivos[i].otros_1990) },
        { codigo: "1999", label: "Provisión otros activos", valores: meses12((i) => m.otrosActivos[i].provision_1999) },
      ] },
    ],
  };

  // Otros depósitos de la 21 que no se proyectan (ahorro solidarias, otros depósitos, por confirmar, 2105 restringidos):
  // se mantiene su saldo del corte todo el año
  const otros21 = obligacionesPublicoProyectadas(saldos, m.captaciones.totalMensual).otras;
  const pasivo: NodoBalance = {
    codigo: "2",
    label: "PASIVO",
    valores: meses12((i) => m.captaciones.totalMensual[i] + otros21 + m.pasivo[i].total),
    hijos: [
      { codigo: "21", label: "Obligaciones con el público", valores: meses12((i) => m.captaciones.totalMensual[i] + otros21),
        hijos: arbol21(saldos, m.captaciones, otros21) },
      { codigo: "25", label: "Cuentas por pagar", valores: meses12((i) => m.pasivo[i].cuentas_por_pagar_25) },
      { codigo: "26", label: "Créditos externos", valores: meses12((i) => m.pasivo[i].creditos_externos_26) },
      { codigo: "29", label: "Otros pasivos", valores: meses12((i) => m.pasivo[i].transferencias_internas_recibidas_2908 + m.pasivo[i].otros_2990), hijos: [
        { codigo: "2908", label: "Transferencias internas", valores: meses12((i) => m.pasivo[i].transferencias_internas_recibidas_2908) },
        { codigo: "2990", label: "Otros", valores: meses12((i) => m.pasivo[i].otros_2990) },
      ] },
    ],
  };

  const patrimonio: NodoBalance = {
    codigo: "3",
    label: "PATRIMONIO",
    valores: meses12((i) => m.patrimonio[i].total_patrimonio),
    hijos: [
      { codigo: "31", label: "Capital social", valores: meses12((i) => m.patrimonio[i].capital_social) },
      { codigo: "33", label: "Reservas", valores: meses12((i) => m.patrimonio[i].reservas) },
      { codigo: "34", label: "Otros aportes patrimoniales", valores: meses12((i) => m.patrimonio[i].otros_aportes_patrimoniales) },
      { codigo: "35", label: "Superávit por valuaciones", valores: meses12((i) => m.patrimonio[i].superavit_por_valuaciones) },
      // 36 = 3601/3602 acumulados (fijos en el año; una pérdida se queda en 3602 hasta compensarse) + 3603/3604 resultado del
      // ejercicio (el del Estado de resultados, acumulado), que se cierra a 3601/3602 al terminar el año
      { codigo: "36", label: "Resultados", valores: meses12((i) => m.patrimonio[i].resultados), hijos: [
        (() => { const v = m.patrimonio[0]?.resultados_acumulados ?? 0; return { codigo: v >= 0 ? "3601" : "3602", label: v >= 0 ? "Utilidades o excedentes acumulados" : "(Pérdidas acumuladas)", valores: meses12((i) => m.patrimonio[i].resultados_acumulados) }; })(),
        (() => { const v = m.patrimonio[11]?.resultado_ejercicio ?? 0; return { codigo: v >= 0 ? "3603" : "3604", label: v >= 0 ? "Utilidad o excedente del ejercicio (Estado de resultados)" : "(Pérdida del ejercicio) (Estado de resultados)", valores: meses12((i) => m.patrimonio[i].resultado_ejercicio) }; })(),
      ] },
    ],
  };

  return { activo, pasivo, patrimonio };
}

interface DetalleMesLinea {
  mes: number;
  porVencer: {
    saldoInicial: number;
    prestamosAConceder: number;
    recuperacionPrestamos: number;
    cuotasCobradas: number;      // recuperación neta (negativo)
    precancelaciones: number;    // precancelaciones con dinero (negativo)
    incrementosRiesgo: number;
    saldoFinal: number;
  };
  enRiesgo: {
    saldoInicial: number;
    incrementosRiesgo: number;
    recuperacionRiesgo: number;
    recuperacionNeta: number;    // positivo
    precancelaciones: number;    // positivo
    castigos: number;           // castigos del modelo de provisión (salen del tramo E)
    saldoFinal: number;
  };
  provision: number;
  ingresoPorInteres: number;
  tasas: {
    metaColocacionAgencia: number;
    cumplimientoColocacion: number;
    pctDistribucion: number;
    pctRecuperacionPeriodo: number;
    tasaEfectividadRecuperacion: number;
    tasaRecuperacionCarteraVencida: number;
    pctPaseRiesgo: number | null;
    pctPrecancelacion: number;
    pctPrecancelacionVencida: number;
    tasaInteresAnual: number;
    ratioProvision: number;
    // Provisión (Cartera → Parámetros → Provisión)
    provisionAnterior: number;      // provisión del mes anterior (positivo)
    pctProvisionObjetivo: number;   // % definido para ese mes
    pctProvisionInicial: number;    // % real del balance cargado
    provisionSinReversiones: boolean;
  };
}

// ---------------------------------------------------------------------
// Provisión por flow rates: detalle para la pantalla de Provisiones (todos los escenarios)
// ---------------------------------------------------------------------
export function calcularProvisionFlowDetalle(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
) {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const pf = m.provisionFlow;
  // Morosidad contable (no devenga + vencida ÷ cartera bruta), ya sin los castigos: la del indicador oficial
  const carteraRiesgo = meses12Pf((i) => m.lineasCartera.reduce((t, r) => t + r.enRiesgo[i].saldoFinal, 0));
  const carteraBruta = meses12Pf((i) => m.lineasCartera.reduce((t, r) => t + r.porVencer[i].saldoFinal + r.enRiesgo[i].saldoFinal, 0));
  if (!pf) return { disponible: false as const, carteraRiesgo, carteraBruta };
  const er = calcularEstadoResultadosMatriz(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const escenarios = Object.fromEntries(Object.entries(pf.escenarios).map(([e, r]) => [e, {
    recuperacion: r.recuperacion,
    productos: Object.fromEntries(m.lineasNombres.map((l) => {
      const x = r.resultado[l];
      return [l, {
        total: x.total, castigos: x.castigos, provision: x.provision, gastoNeto: x.gastoNeto, gasto4402: x.gasto4402,
        reversion: x.reversion, mora: x.mora, saldoE: x.saldoE, saldos: x.saldos, provisionInicio: x.provisionInicio, provisionCorte: x.provisionCorte,
      }];
    })),
  }]));
  return {
    disponible: true as const,
    escenario: pf.escenario, periodoCorte: pf.periodoCorte, mesesPuente: pf.mesesPuente,
    escenarios, controlConstante: pf.controlConstante, ajuste: pf.ajuste,
    simulacion: pf.simulacion,
    // metodología del reparto de castigos y recuperación de castigada entre agencias, y supuestos de la cooperativa
    reparto: provisionFlowDe(saldos)?.reparto ?? null,
    factorMora: { usado: factorMoraDe(parametrosOtrosPasivo), real: provisionFlowDe(saldos)?.factorMoraReal ?? null },
    // supuestos de cartera del presupuesto frente al comportamiento real de la agencia (referencia del modelo)
    cartera: { referencia: provisionFlowDe(saldos)?.referencia ?? null, supuestos: supuestosMoraDe(paramsCredito, factorVencidaDe(saldos)) },
    supuestos: { castigoMensual: pf.config.castigoMensual, recuperacionAnual: pf.config.recuperacionAnual },
    lineas: Object.fromEntries(m.lineasNombres.map((l) => [l, { saldo1499: pf.porLinea[l].saldo1499, noExplicada: pf.porLinea[l].noExplicada, castigosAcumulados: pf.porLinea[l].castigosAcumulados }])),
    provisionGenerica: Math.abs(m.provisionGenerica),
    carteraRiesgo, carteraBruta,
    resultadoEjercicio: er.resultadoDelEjercicio.valores,
  };
}
function meses12Pf(fn: (i: number) => number): number[] { return Array.from({ length: 12 }, (_, i) => fn(i)); }

export function calcularDetalleCarteraMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): Record<Linea, DetalleMesLinea[]> {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);

  const detalle = {} as Record<Linea, DetalleMesLinea[]>;
  m.lineasNombres.forEach((linea, idx) => {
    const r = m.lineasCartera[idx];
    const prov = m.provisionPorLinea[linea];
    detalle[linea] = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      porVencer: {
        saldoInicial: r.porVencer[i].saldoInicial,
        prestamosAConceder: r.porVencer[i].detalle.prestamosAConceder,
        recuperacionPrestamos: r.porVencer[i].detalle.recuperacionPrestamos,
        cuotasCobradas: r.porVencer[i].detalle.cuotasCobradas ?? r.porVencer[i].detalle.recuperacionPrestamos,
        precancelaciones: r.porVencer[i].detalle.precancelaciones ?? 0,
        incrementosRiesgo: r.porVencer[i].detalle.incrementosRiesgo,
        saldoFinal: r.porVencer[i].saldoFinal,
      },
      enRiesgo: {
        saldoInicial: r.enRiesgo[i].saldoInicial,
        incrementosRiesgo: r.enRiesgo[i].detalle.incrementosRiesgo,
        recuperacionRiesgo: r.enRiesgo[i].detalle.recuperacionRiesgo,
        recuperacionNeta: r.enRiesgo[i].detalle.recuperacionNeta ?? r.enRiesgo[i].detalle.recuperacionRiesgo,
        precancelaciones: r.enRiesgo[i].detalle.precancelaciones ?? 0,
        castigos: m.provisionFlow?.porLinea[linea].castigos[i] ?? 0,
        saldoFinal: r.enRiesgo[i].saldoFinal,
      },
      provision: -saldoProvisionMes(prov, i),
      ingresoPorInteres: r.ingresoPorInteres[i],
      tasas: {
        metaColocacionAgencia: r.metaAgencia,
        cumplimientoColocacion: r.cumplimientoPorMes[i] ?? 1,
        pctDistribucion: r.pctDistribucionPorMes[i],
        pctRecuperacionPeriodo: r.parametrosUsados.pctRecuperacionPeriodo[i],
        tasaEfectividadRecuperacion: r.parametrosUsados.tasaEfectividadRecuperacion[i],
        tasaRecuperacionCarteraVencida: r.parametrosUsados.tasaRecuperacionCarteraVencida[i],
        pctPaseRiesgo: r.parametrosUsados.pctPaseRiesgo?.[i] ?? null,
        pctPrecancelacion: r.parametrosUsados.pctPrecancelacion?.[i] ?? 0,
        pctPrecancelacionVencida: r.parametrosUsados.pctPrecancelacionVencida?.[i] ?? 0,
        tasaInteresAnual: r.parametrosUsados.tasaInteresAnual[i],
        ratioProvision: prov.ratioProvisionPorMes[i],
        provisionAnterior: i === 0 ? m.provisionInfo[linea].saldoInicial : m.provisionInfo[linea].requeridaPorMes[i - 1],
        pctProvisionObjetivo: m.provisionInfo[linea].pctObjetivoPorMes[i],
        pctProvisionInicial: m.provisionInfo[linea].pctInicial,
        provisionSinReversiones: m.provisionInfo[linea].sinReversiones,
      },
    }));
  });

  return detalle;
}

// ---------------------------------------------------------------------
// Detalle de Ingreso por Interés de Cartera, por línea (pantalla de Ingresos,
// cuenta 5104 dentro de 51) — mismo cálculo y mismo factor de mora que ya usa
// calcularEstadoResultadosMatriz para el nodo 5104, solo que aquí se reparte
// por línea de negocio en vez de mostrarse ya sumado. La suma de las 4 líneas
// siempre coincide exactamente con el nodo 5104 del Estado de Resultados,
// porque la mora es un multiplicador uniforme (1 + RELACION_MORA_INTERES_NORMAL)
// aplicado por igual a cada línea, así que repartirlo por línea antes de sumar
// da el mismo resultado que sumar primero y aplicar la mora después.
// ---------------------------------------------------------------------

interface DetalleIngresoCarteraMatriz {
  productivo: number[];
  consumo: number[];
  inmobiliario: number[];
  microcredito: number[];
  mora: number[];
  total: number[];
}

export function calcularDetalleIngresoCarteraMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): DetalleIngresoCarteraMatriz {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);

  // Mora separada en su propia fila, en vez de repartida dentro de cada línea:
  // el total sigue siendo exactamente el mismo (4 líneas sin mora + mora, en
  // vez de 4 líneas cada una ya con su mora incluida) porque la mora es un
  // porcentaje uniforme sobre el ingreso por interés de cada línea.
  const porLineaSinMora = {} as Record<Linea, number[]>;
  m.lineasNombres.forEach((linea, idx) => {
    porLineaSinMora[linea] = acumularYTDLocal(m.lineasCartera[idx].ingresoPorInteres);
  });

  const moraPorMes = Array.from({ length: 12 }, (_, i) =>
    m.lineasNombres.reduce((sum, linea, idx) => sum + m.lineasCartera[idx].ingresoPorInteres[i] * m.relacionMoraInteresNormal, 0)
  );
  const mora = acumularYTDLocal(moraPorMes);

  const total = Array.from({ length: 12 }, (_, i) =>
    m.lineasNombres.reduce((sum, linea) => sum + porLineaSinMora[linea][i], 0) + mora[i]
  );

  return {
    productivo: porLineaSinMora.PRODUCTIVO,
    consumo: porLineaSinMora.CONSUMO,
    inmobiliario: porLineaSinMora.INMOBILIARIO,
    microcredito: porLineaSinMora.MICROCREDITO,
    mora,
    total,
  };
}

type NodoResultados = NodoBalance;

export function agruparPorConceptoExacto(filas: FilaPresupuestoDepartamental[], prefijo: string): NodoBalance[] {
  const porConcepto = new Map<string, { nombre: string; valores: number[] }>();
  for (const f of filas) {
    const codigo = f.concepto.replace(/\D/g, "");
    if (!codigo.startsWith(prefijo)) continue;
    if (!porConcepto.has(codigo)) {
      porConcepto.set(codigo, { nombre: f.cuenta_nombre || codigo, valores: Array(12).fill(0) });
    }
    if (f.mes >= 1 && f.mes <= 12) {
      porConcepto.get(codigo)!.valores[f.mes - 1] += f.monto;
    }
  }
  return Array.from(porConcepto.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo, { nombre, valores }]) => ({ codigo, label: nombre, valores }));
}

function sumarArrays(...arrs: number[][]): number[] {
  return Array.from({ length: 12 }, (_, i) => arrs.reduce((sum, a) => sum + a[i], 0));
}

export function calcularEstadoResultadosMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): { egresos: NodoResultados; ingresos: NodoResultados; resultadoDelEjercicio: NodoResultados } {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const externo = construirInputInstitucional(m.provisionFlow ? filasSinRecuperaciones(filasPresupuesto) : filasPresupuesto, empleados, agenciaNombre);
  externo.aportesSEPSPorMes = [...m.contribuciones.seps.porMes];
  const otros56Presupuesto = [...externo.otrosIngresosPorMes];
  if (m.provisionFlow) externo.otrosIngresosPorMes = externo.otrosIngresosPorMes.map((v, i) => v + m.provisionFlow!.recuperacion[i]);

  const intCausados = calcularInteresesCausadosDetalle(m, paramsCaptaciones);
  const n41: NodoBalance = {
    codigo: "41", label: "Intereses Causados",
    valores: intCausados.totalAcumulado,
    hijos: [
      { codigo: "4101", label: "Obligaciones con el público", valores: intCausados.obligacionesConElPublicoAcumulado },
      { codigo: "4103", label: "Obligaciones Financieras (créditos externos)", valores: intCausados.obligacionesFinancierasAcumulado },
    ],
  };

  const hijos42 = agruparPorConceptoExacto(filasPresupuesto, "42");
  const acum42 = hijos42.length > 0
    ? sumarArrays(...hijos42.map((h) => acumularYTDLocal(h.valores)))
    : acumularYTDLocal(externo.comisionesCausadasPorMes);
  hijos42.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const n42: NodoBalance = { codigo: "42", label: "Comisiones Causadas", valores: acum42, hijos: hijos42.length ? hijos42 : undefined };

  const NOMBRES_LINEA_LOCAL: Record<Linea, string> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
  // Con el modelo de flow rates: 4402 por producto (440210…440240) solo con el gasto positivo;
  // el gasto neto negativo va a 5604.10 (reversión), dentro de Otros ingresos.
  const pf = m.provisionFlow;
  const hijos44: NodoBalance[] = m.lineasNombres.map((linea) => (pf ? {
    codigo: pf.porLinea[linea].cuenta4402, label: `Crédito ${NOMBRES_LINEA_LOCAL[linea].toLowerCase()}`,
    valores: acumularYTDLocal(pf.porLinea[linea].gasto4402),
  } : {
    codigo: "", label: NOMBRES_LINEA_LOCAL[linea],
    valores: calcularVariacionProvisionAcumuladaLocal(m.provisionPorLinea[linea]),
  }));
  const n44: NodoBalance = { codigo: "44", label: "Provisión", valores: sumarArrays(...hijos44.map((h) => h.valores)), hijos: hijos44 };

  const hijos4501 = agruparPorConceptoExacto(filasPresupuesto, "4501");
  hijos4501.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const n4501: NodoBalance = {
    codigo: "4501", label: "Gastos de Personal",
    valores: acumularYTDLocal(externo.gastosPersonalPorMes),
    hijos: hijos4501.length ? hijos4501 : undefined,
  };

  const hijos4502 = agruparPorConceptoExacto(filasPresupuesto, "4502");
  hijos4502.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const n4502: NodoBalance = { codigo: "4502", label: "Honorarios", valores: acumularYTDLocal(externo.honorariosPorMes), hijos: hijos4502.length ? hijos4502 : undefined };

  const hijos4503 = agruparPorConceptoExacto(filasPresupuesto, "4503");
  hijos4503.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const n4503: NodoBalance = { codigo: "4503", label: "Servicios Varios", valores: acumularYTDLocal(externo.serviciosVariosPorMes), hijos: hijos4503.length ? hijos4503 : undefined };

  const cosede = { primaFijaAcumulada: acumularYTDLocal(m.contribuciones.cosede.fija), primaVariableAcumulada: acumularYTDLocal(m.contribuciones.cosede.par) };
  const n4504: NodoBalance = {
    codigo: "4504", label: "Impuestos, Contribuciones y Multas",
    valores: sumarArrays(
      acumularYTDLocal(externo.impuestosMunicipalesYOtrosPorMes),
      acumularYTDLocal(externo.aportesSEPSPorMes),
      cosede.primaFijaAcumulada,
      cosede.primaVariableAcumulada
    ),
    hijos: [
      { codigo: "4504", label: "Impuestos fiscales, municipales y otros", valores: acumularYTDLocal(externo.impuestosMunicipalesYOtrosPorMes) },
      { codigo: "450415", label: "Aportes a la SEPS", valores: acumularYTDLocal(externo.aportesSEPSPorMes) },
      { codigo: "450420", label: "Aportes COSEDE — prima fija", valores: cosede.primaFijaAcumulada },
      { codigo: "450421", label: "Aportes COSEDE — prima variable", valores: cosede.primaVariableAcumulada },
    ],
  };

  const hijos4505: NodoBalance[] = m.categoriasAF.map((cat, idx) => ({
    codigo: CODIGO_AF[cat.nombre]?.gasto ?? cat.codigo, label: cat.nombre,
    valores: acumularYTDLocal(m.resultadosAF[idx].map((r) => -r.depreciacion_del_mes)),
  }));
  const n4505: NodoBalance = { codigo: "4505", label: "Depreciaciones", valores: sumarArrays(...hijos4505.map((h) => h.valores)), hijos: hijos4505 };

  // 4506 por subcuenta: gasto devengado de las partidas de 1904 y 1905
  const difER = diferidosDe(saldos);
  const hijos4506: NodoBalance[] = difER
    ? Object.entries([difER.grupos["1904"].gastoPorCuenta, difER.grupos["1905"].gastoPorCuenta].reduce<Record<string, number[]>>((acc, o) => {
        for (const [k, v] of Object.entries(o)) { if (k.startsWith("4503")) continue; const a = (acc[k] ??= Array(12).fill(0)); v.forEach((x, i) => { a[i] += x; }); }
        return acc;
      }, {})).filter(([, v]) => v.some((x) => Math.abs(x) >= 0.5)).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ codigo: k, label: difER.nombres?.[k] ?? "Amortización", valores: acumularYTDLocal(v) }))
    : [];
  const n4506: NodoBalance = {
    codigo: "4506", label: "Amortizaciones",
    valores: difER ? sumarArrays(Array(12).fill(0), ...hijos4506.map((h) => h.valores)) : acumularYTDLocal(m.insumosOtrosActivos.gastosAnticipadosSalidas),
    ...(hijos4506.length ? { hijos: hijos4506 } : {}),
  };

  // 450705 Suministros sale de Materiales (1906): lo cargado a mano en 450705 no se suma (tampoco en el resultado que va a 36)
  const hijos4507Manual = agruparPorConceptoExacto(filasPresupuesto, "4507").filter((h) => !h.codigo.startsWith("450705"));
  hijos4507Manual.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const suministrosAcum = acumularYTDLocal(m.insumosOtrosActivos.materialesSalidas);
  const n4507: NodoBalance = {
    codigo: "4507", label: "Otros Gastos",
    valores: sumarArrays(suministrosAcum, ...hijos4507Manual.map((h) => h.valores)),
    hijos: [{ codigo: "450705", label: "Suministros diversos", valores: suministrosAcum }, ...hijos4507Manual],
  };

  const n45: NodoBalance = {
    codigo: "45", label: "Gastos de Operación",
    valores: sumarArrays(n4501.valores, n4502.valores, n4503.valores, n4504.valores, n4505.valores, n4506.valores, n4507.valores),
    hijos: [n4501, n4502, n4503, n4504, n4505, n4506, n4507],
  };

  const hijos47 = agruparPorConceptoExacto(filasPresupuesto, "47");
  hijos47.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const acum47 = hijos47.length > 0 ? sumarArrays(...hijos47.map((h) => h.valores)) : acumularYTDLocal(externo.otrosGastosYPerdidasPorMes);
  const n47: NodoBalance = { codigo: "47", label: "Otros Gastos y Pérdidas", valores: acum47, hijos: hijos47.length ? hijos47 : undefined };

  const hijos48 = agruparPorConceptoExacto(filasPresupuesto, "48");
  hijos48.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const acum48 = hijos48.length > 0 ? sumarArrays(...hijos48.map((h) => h.valores)) : acumularYTDLocal(externo.participacionEmpleadosEImpuestoRentaPorMes);
  const n48: NodoBalance = { codigo: "48", label: "Participación e Impuesto a la Renta", valores: acum48, hijos: hijos48.length ? hijos48 : undefined };

  // Lo cargado en cuentas sin línea propia (43, 46, 4508…) también entra: en su grupo si ya existe, o en uno nuevo
  const filasER = m.provisionFlow ? filasSinRecuperaciones(filasPresupuesto) : filasPresupuesto;
  const adicionales = (clave: "otrosEgresosAdicionalesPorMes" | "otrosIngresosAdicionalesPorMes", base: NodoBalance[]) => {
    const filas = filasER.filter((f) => claveConceptoPorCuenta(f.concepto) === clave);
    const grupos = [...new Set(filas.map((f) => f.concepto.replace(/\D/g, "").slice(0, 2)))].sort();
    const nodos = [...base];
    for (const g of grupos) {
      const hs = agruparPorConceptoExacto(filas, g); hs.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
      const suma = sumarArrays(...hs.map((h) => h.valores));
      const i = nodos.findIndex((n) => n.codigo === g);
      if (i >= 0) nodos[i] = { ...nodos[i], valores: sumarArrays(nodos[i].valores, suma), hijos: [...(nodos[i].hijos ?? []), ...hs] };
      else nodos.push({ codigo: g, label: NOMBRE_GRUPO_RESULTADOS[g] ?? `Grupo ${g}`, valores: suma, hijos: hs });
    }
    return nodos.sort((a, b) => a.codigo.localeCompare(b.codigo));
  };
  const hijosEgresos = adicionales("otrosEgresosAdicionalesPorMes", [n41, n42, n44, n45, n47, n48]);
  const egresos: NodoResultados = {
    codigo: "4", label: "EGRESOS",
    valores: sumarArrays(...hijosEgresos.map((h) => h.valores)),
    hijos: hijosEgresos,
  };

  const ingresoCarteraAcum = calcularIngresosCarteraAcumulado({
    ingresoPorInteresPorProducto: m.lineasCartera.map((r) => r.ingresoPorInteres),
    relacionMoraInteresNormal: m.relacionMoraInteresNormal,
  });
  // 5104 (Cartera de Crédito) es real/calculado y nunca sale de presupuesto_departamental
  // (bloqueado en la pantalla de Ingresos), así que se excluye del agrupado dinámico y se
  // agrega siempre como hijo fijo. Cualquier otro código bajo 51 (5101, 5103, 5190, etc.)
  // se muestra como su propia línea, igual que ya hacen 42/47/48.
  const hijos51Manual = agruparPorConceptoExacto(filasPresupuesto, "51").filter((h) => !h.codigo.startsWith("5104"));
  hijos51Manual.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const acum51Manual = hijos51Manual.length > 0
    ? sumarArrays(...hijos51Manual.map((h) => h.valores))
    : acumularYTDLocal(externo.depositosEInversionesPorMes);
  const n51: NodoBalance = {
    codigo: "51", label: "Intereses y Descuentos Ganados",
    valores: sumarArrays(acum51Manual, ingresoCarteraAcum),
    hijos: [
      ...(hijos51Manual.length > 0 ? hijos51Manual : [{ codigo: "5101/5103", label: "Depósitos e Inversiones", valores: acumularYTDLocal(externo.depositosEInversionesPorMes) }]),
      { codigo: "5104", label: "Cartera de Crédito", valores: ingresoCarteraAcum },
    ],
  };
  const n53: NodoBalance = { codigo: "53", label: "Utilidades Financieras", valores: acumularYTDLocal(externo.utilidadesFinancierasPorMes) };
  const n54: NodoBalance = { codigo: "54", label: "Ingresos por Servicios", valores: acumularYTDLocal(externo.ingresosPorServiciosPorMes) };
  const n55: NodoBalance = { codigo: "55", label: "Otros Ingresos Operacionales", valores: acumularYTDLocal(externo.otrosIngresosOperacionalesPorMes) };
  const n56: NodoBalance = pf ? {
    codigo: "56", label: "Otros Ingresos",
    valores: sumarArrays(acumularYTDLocal(externo.otrosIngresosPorMes), acumularYTDLocal(pf.reversion)),
    hijos: [
      { codigo: "560405", label: "Recuperación de activos castigados", valores: acumularYTDLocal(pf.recuperacion) },
      { codigo: "560410", label: "Reversión de provisiones", valores: acumularYTDLocal(pf.reversion) },
      { codigo: "56", label: "Otros ingresos (presupuesto)", valores: acumularYTDLocal(otros56Presupuesto) },
    ],
  } : { codigo: "56", label: "Otros Ingresos", valores: acumularYTDLocal(externo.otrosIngresosPorMes) };

  const hijos52 = agruparPorConceptoExacto(filasER, "52");
  hijos52.forEach((h) => { h.valores = acumularYTDLocal(h.valores); });
  const n52: NodoBalance = { codigo: "52", label: "Comisiones Ganadas", valores: acumularYTDLocal(externo.comisionesGanadasCarteraPorMes), hijos: hijos52.length ? hijos52 : undefined };
  const hijosIngresos = adicionales("otrosIngresosAdicionalesPorMes", [n51, n52, n53, n54, n55, n56]);
  const ingresos: NodoResultados = {
    codigo: "5", label: "INGRESOS",
    valores: sumarArrays(...hijosIngresos.map((h) => h.valores)),
    hijos: hijosIngresos,
  };

  const resultadoDelEjercicio: NodoResultados = {
    codigo: "", label: "RESULTADO DEL EJERCICIO",
    valores: Array.from({ length: 12 }, (_, i) => ingresos.valores[i] - egresos.valores[i]),
  };

  return { egresos, ingresos, resultadoDelEjercicio };
}

const NOMBRE_GRUPO_RESULTADOS: Record<string, string> = {
  "43": "Pérdidas Financieras", "46": "Otras Pérdidas Operacionales", "49": "Cuentas de Resultados Acreedoras",
  "50": "Ingresos", "57": "Otros Ingresos", "59": "Pérdidas y Ganancias",
};

function acumularYTDLocal(valoresPorMes: number[]): number[] {
  const acumulado: number[] = [];
  let suma = 0;
  for (let i = 0; i < 12; i++) { suma += valoresPorMes[i]; acumulado.push(suma); }
  return acumulado;
}

function calcularVariacionProvisionAcumuladaLocal(params: ParametrosLineaProvision): number[] {
  const flujoMensual: number[] = [];
  let saldoAnterior = params.saldoInicialDicAnterior;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = -saldoProvisionMes(params, i);
    flujoMensual.push(-(saldoFinal - saldoAnterior) + (params.castigosPorMes?.[i] ?? 0));
    saldoAnterior = saldoFinal;
  }
  return acumularYTDLocal(flujoMensual);
}

function calcularIngresosCarteraAcumulado(params: { ingresoPorInteresPorProducto: number[][]; relacionMoraInteresNormal: number }): number[] {
  const flujoMensualSinMora = Array.from({ length: 12 }, (_, i) => params.ingresoPorInteresPorProducto.reduce((sum, arr) => sum + arr[i], 0));
  const flujoMensualMora = flujoMensualSinMora.map((v) => v * params.relacionMoraInteresNormal);
  return acumularYTDLocal(flujoMensualSinMora.map((v, i) => v + flujoMensualMora[i]));
}

function calcularInteresesCausadosDetalle(
  m: ReturnType<typeof construirTodosLosMotores>,
  paramsCaptaciones: FilaParametroCaptaciones[]
): { obligacionesConElPublicoAcumulado: number[]; obligacionesFinancierasAcumulado: number[]; totalAcumulado: number[] } {
  const dpfParams = paramsCaptaciones.filter((f) => f.producto === "DPF");
  const tasaDPFAnualPorMes = arr12(dpfParams, "tasa_interes_anual");
  const flujoMensualAhorros = m.captaciones.vista.map((r, i) => r.detalle.capitalizacionInteres + m.captaciones.crecer[i].detalle.capitalizacionInteres);
  const flujoMensualDPF = m.captaciones.dpf.map((r, i) => ((r.saldoInicial + r.saldoFinal) / 2) * (tasaDPFAnualPorMes[i] / 12));
  const flujoMensualObligPublico = flujoMensualAhorros.map((v, i) => v + flujoMensualDPF[i]);
  const obligacionesConElPublicoAcumulado = acumularYTDLocal(flujoMensualObligPublico);
  const obligacionesFinancierasAcumulado = acumularYTDLocal(Array(12).fill(0));
  return {
    obligacionesConElPublicoAcumulado,
    obligacionesFinancierasAcumulado,
    totalAcumulado: obligacionesConElPublicoAcumulado.map((v, i) => v + obligacionesFinancierasAcumulado[i]),
  };
}


interface DetalleMesCaptaciones {
  mes: number;
  saldoInicial: number;
  saldoFinal: number;
  depositos: number;
  retiros: number;
  capitalizacionInteres: number;
  cancelaciones: number;
  renovaciones: number;
  tasas: {
    tasaInteresAnual: number;
    pctIngresosPeriodo: number;
    pctRetirosPeriodo: number;
    pctCancelaciones: number;
    ratioRenovaciones: number;
  };
}

export function calcularDetalleCaptacionesMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[]
): { vista: DetalleMesCaptaciones[]; crecer: DetalleMesCaptaciones[]; dpf: DetalleMesCaptaciones[] } {
  const captaciones = construirCaptaciones(saldos, paramsCaptaciones);

  function construirDetalle(resultado: ResultadoMensual[], params: FilaParametroCaptaciones[]): DetalleMesCaptaciones[] {
    return Array.from({ length: 12 }, (_, i) => {
      const r = resultado[i];
      const fila = params.find((f) => f.mes === i + 1);
      const d = r.detalle as Record<string, number>;
      return {
        mes: i + 1,
        saldoInicial: r.saldoInicial,
        saldoFinal: r.saldoFinal,
        depositos: d.depositos ?? 0,
        retiros: d.retiros ?? 0,
        capitalizacionInteres: d.capitalizacionInteres ?? 0,
        cancelaciones: d.cancelaciones ?? 0,
        renovaciones: d.renovaciones ?? 0,
        tasas: {
          tasaInteresAnual: fila?.tasa_interes_anual ?? 0,
          pctIngresosPeriodo: fila?.pct_ingresos ?? 0,
          pctRetirosPeriodo: fila?.pct_retiros ?? 0,
          pctCancelaciones: fila?.pct_cancelaciones ?? 0,
          ratioRenovaciones: fila?.ratio_renovaciones ?? 0,
        },
      };
    });
  }

  const vistaParams = paramsCaptaciones.filter((f) => f.producto === "VISTA");
  const crecerParams = paramsCaptaciones.filter((f) => f.producto === "CRECER");
  const dpfParams = paramsCaptaciones.filter((f) => f.producto === "DPF");

  return {
    vista: construirDetalle(captaciones.vista, vistaParams),
    crecer: construirDetalle(captaciones.crecer, crecerParams),
    dpf: construirDetalle(captaciones.dpf, dpfParams),
  };
}

interface DetalleMesActivoFijo {
  mes: number;
  costoInicioMes: number;
  adquisicionDelMes: number;
  costoFinMes: number;
  depreciacionAcumuladaInicioMes: number; // negativo
  depreciacionDelMes: number;
  depreciacionAcumulada: number; // negativo -- fin de mes
  valorNetoEnLibros: number;
  tasas: { factorAnual: number };
}

interface DetalleMesTerrenos {
  mes: number;
  costoInicioMes: number;
  adquisicionDelMes: number;
  costoFinMes: number;
}

export function calcularDetalleActivoFijoMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  /** Revalúos de terrenos y edificios (Patrimonio → Otras cuentas): suben el costo como en el Balance. */
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): { categorias: Record<string, DetalleMesActivoFijo[]>; terrenos: DetalleMesTerrenos[] } {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);

  const categorias = {} as Record<string, DetalleMesActivoFijo[]>;
  m.categoriasAF.forEach((cat, idx) => {
    const r = m.resultadosAF[idx];
    categorias[cat.nombre] = r.map((x) => ({
      mes: x.mes,
      costoInicioMes: x.costo_inicio_mes,
      adquisicionDelMes: x.adquisicion_del_mes,
      costoFinMes: x.costo_fin_mes,
      depreciacionAcumuladaInicioMes: x.depreciacion_acumulada_inicio_mes,
      depreciacionDelMes: x.depreciacion_del_mes,
      depreciacionAcumulada: x.depreciacion_acumulada,
      valorNetoEnLibros: x.valor_neto_en_libros,
      tasas: { factorAnual: cat.tasa_anual },
    }));
  });

  const terrenos: DetalleMesTerrenos[] = m.terrenos.map((t) => ({
    mes: t.mes,
    costoInicioMes: t.costo_inicio_mes,
    adquisicionDelMes: t.adquisicion_del_mes,
    costoFinMes: t.costo_fin_mes,
  }));

  return { categorias, terrenos };
}

// ---------------------------------------------------------------------
// Detalle de Otros Activos (pantalla dedicada, por subcuenta y mes)
// ---------------------------------------------------------------------

interface DetalleMesRollforward {
  mes: number;
  saldoInicio: number;
  entradas: number;
  salidas: number;
  saldoFin: number;
}

interface DetalleMesFondoLiquidez {
  mes: number;
  obligacionesFinMes: number;       // grupo 21 proyectado al cierre del mes (base)
  promedioObligacionesAprox: number; // Paso 1
  pctVigente: number;               // % escrito (o el de defecto)
  pctAplicado: number;              // % usado = mínimo entre el vigente y la meta
  aporteMensualActual: number;      // Paso 2 = promedio × % aplicado
  saldoInicial: number;
  ajuste: number;                   // Paso 3 = aporte de este mes − aporte del mes anterior
  saldoFinal: number;
}

/** Saldos de la cuenta 19 por subcuenta y mes (Resumen de Otros activos). */
interface ResumenOtrosActivosMes {
  mes: number;
  c1901: number; c1902: number; c1904: number; c1905: number; c1906: number; c1908: number; c1990: number; c1999: number; total: number;
}

export function calcularDetalleOtrosActivosMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): {
  inversiones1901: number;
  fondoLiquidez1902: DetalleMesFondoLiquidez[];
  gastosAnticipados1904: DetalleMesRollforward[];
  materiales1906: DetalleMesRollforward[];
  transferencias1908: DetalleMesRollforward[];
  cuentasPorCobrar16: DetalleMesRollforward[];
  cuentasPorCobrarInfo: { base16: number; c1602: number; carteraPorVencerCorte: number; carteraPorVencerPorMes: number[]; interes1602PorMes: number[];
    devengado1602PorMes: number[]; vencido1602PorMes: number[]; retencion1602PorMes: number[] };
  resumen19: ResumenOtrosActivosMes[];
  fondoLiquidezInfo: {
    saldo1902Corte: number; aportesCorte: number; rendimientosCorte: number; rendimientoPorMes: number[]; rendimiento: { tasa: number; real: number | null; guardada: boolean; acumuladoCorte: number | null; base1902: number } | null; obligacionesCorte: number; captacionesCorte: number; otras21: number;
    pctImplicitoCorte: number | null; meta: number; pctGuardado: boolean;
  };
  corteCuentas: { c19: number | null; c1901: number; c1902: number; c1904: number; c1905: number; c1906: number; c1908: number; c1990: number; c1999: number; c16: number };
} {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const insumos = m.insumosOtrosActivos;
  const insumosCxC = m.insumosPatrimonioYCxc;

  const cuentasPorCobrar = calcularRollforwardSimple({
    saldoInicialEnero: insumosCxC.cuentasPorCobrarSaldoInicial,
    entradasPorMes: insumosCxC.cuentasPorCobrarVariacionPorMes,
    salidasPorMes: Array(12).fill(0),
  });

  const fondoLiquidez = calcularFondoLiquidez({
    pctVigentePorMes: insumos.pctVigentePorMes,
    metaPct: parametrosVigentesDe(saldos).fondo_liquidez_meta,
    saldoObligacionesPublicoDicAnterior: insumos.saldoObligacionesPublicoDicAnterior,
    saldo1902DicAnterior: insumos.saldo1902DicAnterior,
    totalCaptacionesPorMes: insumos.totalCaptacionesPorMes,
  });
  const v = (c: string) => Number(saldos[c]) || 0;
  const gastosAnticipados = calcularRollforwardSimple({
    saldoInicialEnero: insumos.gastosAnticipadosSaldoInicial,
    entradasPorMes: insumos.gastosAnticipadosEntradas,
    salidasPorMes: insumos.gastosAnticipadosSalidas,
  });
  const materiales = calcularRollforwardSimple({
    saldoInicialEnero: insumos.materialesSaldoInicial,
    entradasPorMes: insumos.materialesEntradas,
    salidasPorMes: insumos.materialesSalidas,
  });
  const transferencias = calcularRollforwardSimple({
    saldoInicialEnero: insumos.transferencias1908SaldoInicial,
    entradasPorMes: insumos.transferenciasOA1908Entradas,
    salidasPorMes: insumos.transferenciasOA1908Salidas,
  });

  return {
    inversiones1901: insumos.saldoInicialInversiones1901,
    fondoLiquidez1902: fondoLiquidez.map((r, i) => ({
      mes: r.mes,
      obligacionesFinMes: insumos.totalCaptacionesPorMes[i],
      promedioObligacionesAprox: r.promedio_obligaciones_aprox,
      pctVigente: insumos.pctVigentePorMes[i],
      pctAplicado: r.pct_aplicado,
      aporteMensualActual: r.aporte_mensual_actual,
      saldoInicial: r.saldo_inicial,
      ajuste: r.ajuste,
      saldoFinal: r.saldo_final,
    })),
    // 1904 y 1905 por separado (cada una con su registro de partidas); sin registro, todo va en la 1904
    resumen19: m.otrosActivos.map((r, i) => ({
      mes: r.mes, c1901: r.inversiones_1901, c1902: r.derechos_fiduciarios_1902,
      c1904: r.gastos_anticipados_1904 - (diferidosDe(saldos)?.grupos["1905"].saldoPorMes[i] ?? 0),
      c1905: diferidosDe(saldos)?.grupos["1905"].saldoPorMes[i] ?? 0,
      c1906: r.materiales_1906, c1908: r.transferencias_internas_1908, c1990: r.otros_1990, c1999: r.provision_1999, total: r.total,
    })),
    fondoLiquidezInfo: {
      saldo1902Corte: insumos.saldo1902DicAnterior + (insumos.rendimientos1902 ?? 0),
      aportesCorte: insumos.saldo1902DicAnterior,
      rendimientosCorte: insumos.rendimientos1902 ?? 0,
      rendimientoPorMes: insumos.rendimientoFL ?? Array(12).fill(0),
      rendimiento: (() => { const r = rendimientoFLDe(saldos); return r ? { tasa: r.tasa, real: r.real, guardada: r.guardada, acumuladoCorte: r.acumuladoCorte ?? null, base1902: r.base1902 ?? 0 } : null; })(),
      obligacionesCorte: insumos.saldoObligacionesPublicoDicAnterior,
      captacionesCorte: insumos.obligacionesCaptacionesCorte,
      otras21: insumos.obligacionesOtras21,
      pctImplicitoCorte: insumos.saldoObligacionesPublicoDicAnterior ? insumos.saldo1902DicAnterior / insumos.saldoObligacionesPublicoDicAnterior : null,
      meta: parametrosVigentesDe(saldos).fondo_liquidez_meta,
      pctGuardado: insumos.pctGuardado,
    },
    corteCuentas: {
      c19: saldos["19"] !== undefined ? v("19") : null,
      c1901: v("1901"), c1902: v("1902"), c1904: diferidosDe(saldos) ? v("1904") : v("1904") + v("1905"), c1905: diferidosDe(saldos) ? v("1905") : 0, c1906: v("1906"), c1908: v("1908"),
      c1990: v("1990"), c1999: -Math.abs(v("1999")), c16: v("16"),
    },
    gastosAnticipados1904: gastosAnticipados.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      entradas: insumos.gastosAnticipadosEntradas[i], salidas: insumos.gastosAnticipadosSalidas[i],
      saldoFin: r.saldo_final,
    })),
    materiales1906: materiales.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      entradas: insumos.materialesEntradas[i], salidas: insumos.materialesSalidas[i],
      saldoFin: r.saldo_final,
    })),
    transferencias1908: transferencias.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      entradas: insumos.transferenciasOA1908Entradas[i], salidas: insumos.transferenciasOA1908Salidas[i],
      saldoFin: r.saldo_final,
    })),
    cuentasPorCobrar16: cuentasPorCobrar.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      entradas: insumosCxC.cuentasPorCobrarVariacionPorMes[i], salidas: 0,
      saldoFin: r.saldo_final,
    })),
    // 1602: saldo del corte + lo que mueve el registro de Inversiones (interés devengado por cobrar)
    // Movimiento de la 1602: + interés devengado − interés que vence (se capitaliza al renovar o se cobra al
    // cancelar) + retención en la fuente (crédito tributario). Saldo final = 1602 del corte + variación del registro.
    cuentasPorCobrarInfo: (() => {
      const inv = inversionesDe(saldos);
      const z = Array(12).fill(0) as number[];
      const dev = inv ? inv.interesDevengadoPorMes : z;
      const pend = inv ? inv.interesPendientePorMes : z;
      const ini = inv ? inv.interesPorCobrarInicial : 0;
      return {
        ...insumosCxC.cuentasPorCobrarInfo,
        interes1602PorMes: Array.from({ length: 12 }, (_, i) => insumosCxC.cuentasPorCobrarInfo.c1602 + (inv?.variacion16PorMes[i] ?? 0)),
        devengado1602PorMes: [...dev],
        vencido1602PorMes: dev.map((d, i) => (i === 0 ? ini : pend[i - 1]) + d - pend[i]),
        retencion1602PorMes: inv ? [...inv.retencionPorMes] : z,
      };
    })(),
  };
}

// ---------------------------------------------------------------------
// Detalle de Pasivo (pantalla dedicada, por subcuenta y mes)
// ---------------------------------------------------------------------

export function calcularDetallePasivoMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): {
  cuentasPorPagar25: (DetalleMesRollforward & { polizasAlta: number; polizasPago: number })[];
  creditosExternos26: DetalleMesRollforward[];
  transferencias2908: DetalleMesRollforward[];
  otros2990: number;
} {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const insumos = m.insumosPasivo;

  const cxp = calcularCuentasPorPagar({
    saldoInicialEnero: insumos.cuentasPorPagarSaldoInicial,
    incrementosPorMes: insumos.cuentasPorPagarIncrementos,
    pagosPorMes: insumos.cuentasPorPagarPagos,
  });
  // Créditos externos: 4 líneas, todas en $0 por política institucional --
  // se agregan en una sola serie para la pantalla (el detalle individual no
  // aporta nada mientras las 4 sigan en $0).
  const creditosPorLinea = insumos.creditosExternos.map(calcularCreditoExterno);
  const creditosTotal: DetalleMesRollforward[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    saldoInicio: creditosPorLinea.reduce((sum, c) => sum + c[i].saldo_inicial, 0),
    entradas: insumos.creditosExternos.reduce((sum, c) => sum + c.incrementosPorMes[i], 0),
    salidas: insumos.creditosExternos.reduce((sum, c) => sum + c.pagosPorMes[i], 0),
    saldoFin: creditosPorLinea.reduce((sum, c) => sum + c[i].saldo_final, 0),
  }));
  const transf = calcularTransferenciasInternasRecibidas({
    saldoInicialEnero: insumos.transferencias2908SaldoInicial,
    incrementosPorMes: insumos.transf2908Incrementos,
    disminucionesPorMes: insumos.transf2908Disminuciones,
  });

  return {
    cuentasPorPagar25: cxp.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      // entradas y salidas = lo escrito a mano; las pólizas pagadas en cuotas van aparte
      entradas: insumos.cuentasPorPagarIncrementos[i] - (insumos.polizasPorPagarAlta?.[i] ?? 0), salidas: insumos.cuentasPorPagarPagos[i] - (insumos.polizasPorPagarPago?.[i] ?? 0),
      polizasAlta: insumos.polizasPorPagarAlta?.[i] ?? 0, polizasPago: insumos.polizasPorPagarPago?.[i] ?? 0,
      saldoFin: r.saldo_final,
    })),
    creditosExternos26: creditosTotal,
    // 2990 (otros pasivos) no tiene movimiento: se mantiene en el saldo del corte (igual que en el Balance)
    otros2990: s(saldos, "2990"),
    transferencias2908: transf.map((r, i) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial,
      entradas: insumos.transf2908Incrementos[i], salidas: insumos.transf2908Disminuciones[i],
      saldoFin: r.saldo_final,
    })),
  };
}

// ---------------------------------------------------------------------
// Detalle de Patrimonio (pantalla dedicada, por subcuenta y mes)
// ---------------------------------------------------------------------

interface DetalleMesCapitalSocial {
  mes: number;
  saldoInicio: number;
  incrementos: number;
  retiros: number;
  capitalizacionDividendos: number;
  saldoFin: number;
  sociosTotal: number;
}

export function calcularDetallePatrimonioMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): {
  capitalSocial31: DetalleMesCapitalSocial[];
  saldoReservas33: number;
  saldoOtrosAportes34: number;
  saldoSuperavit35: number;
  resultados36PorMes: number[];
  otrosAportes34PorMes: number[];
  superavit35PorMes: number[];
  donacionesEfectivoPorMes: number[];
  revaluoTerrenosPorMes: number[];
  revaluoEdificiosPorMes: number[];
} {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const insumos = m.insumosPatrimonioYCxc;

  const capitalSocial = calcularDetalleCapitalSocial(insumos.configCapitalSocial);
  const resultadosAcumuladosIniciales36 = s(saldos, "36");

  return {
    capitalSocial31: capitalSocial.map((r) => ({
      mes: r.mes, saldoInicio: r.saldo_inicial, incrementos: r.incrementos, retiros: r.retiros,
      capitalizacionDividendos: r.capitalizacion_dividendos, saldoFin: r.saldo_final, sociosTotal: r.socios_total,
    })),
    saldoReservas33: insumos.saldoReservas33,
    saldoOtrosAportes34: insumos.saldoOtrosAportes34,
    saldoSuperavit35: insumos.saldoSuperavit35,
    resultados36PorMes: m.ingresosEgresos.map((r) => resultadosAcumuladosIniciales36 + r.resultado_del_ejercicio_acumulado),
    otrosAportes34PorMes: m.patrimonio.map((r) => r.otros_aportes_patrimoniales),
    superavit35PorMes: m.patrimonio.map((r) => r.superavit_por_valuaciones),
    donacionesEfectivoPorMes: insumos.donacionesEfectivoPorMes,
    revaluoTerrenosPorMes: insumos.revaluoTerrenosPorMes,
    revaluoEdificiosPorMes: insumos.revaluoEdificiosPorMes,
  };
}

// ---------------------------------------------------------------------
// Flujo de Efectivo (pantalla dedicada) — Fuentes y Usos de Capital,
// replica la estructura del Excel: Saldo inicial, Fuentes, Usos, Reservas
// de liquidez, Disponible para créditos, Monto a conceder, Saldo final.
// Cada línea de Fuentes/Usos usa MONTOS MENSUALES AISLADOS (no acumulado
// YTD) -- coherente con como ya funciona calcularFlujoEfectivoMatriz.
// Cada nodo trae "formulas": 12 explicaciones (una por mes) con los
// numeros reales de ESE mes, mismo patron que ya usan Cartera y Otros
// Activos para el icono de "ver formula".
// ---------------------------------------------------------------------

interface NodoFlujoEfectivo {
  codigo: string;
  label: string;
  valores: number[];
  formulas?: string[];
  hijos?: NodoFlujoEfectivo[];
}

const NOMBRES_MES_FLUJO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmtFlujo(n: number): string {
  const signo = n < 0 ? "-" : "";
  return signo + "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
}

export function calcularFlujoEfectivoArbolMatriz(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[] = [],
  empleados: FilaEmpleadoNomina[] = [],
  agenciaNombre: string = "Matriz",
  oficialesCredito: FilaOficialCredito[] = [],
  metasCredito?: MetasCreditoInstitucional,
  factoresDepreciacion?: FactoresDepreciacion,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = []
): NodoFlujoEfectivo[] {
  const m = construirTodosLosMotores(saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo);
  const ins = m.insumosFlujoEfectivo;
  const meses12 = (fn: (i: number) => number) => Array.from({ length: 12 }, (_, i) => fn(i));
  const porMes = (fn: (i: number) => string) => Array.from({ length: 12 }, (_, i) => fn(i));

  const depositosAhorros = meses12((i) => ins.depositosAhorroVistaPorMes[i] + ins.depositosAhorroCrecerPorMes[i]);
  const retiroAhorros = meses12((i) => Math.abs(ins.retirosAhorroVistaPorMes[i]) + Math.abs(ins.retirosAhorroCrecerPorMes[i]));
  const cuentasPorCobrarFuente = meses12((i) => -ins.cuentasPorCobrarVariacionPorMes[i]);
  const cuentasPorPagarUso = meses12((i) => -ins.cuentasPorPagarPagosPorMes[i]);
  const retiroDPF = meses12((i) => Math.abs(ins.cancelacionesDPFPorMes[i]));

  const hijosFuentes: NodoFlujoEfectivo[] = [
    {
      codigo: "", label: "Depósitos Ahorros", valores: depositosAhorros,
      formulas: porMes((i) => `Depósitos de Ahorro a la Vista + Depósitos de Ahorro Crecer, del motor de Captaciones. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.depositosAhorroVistaPorMes[i])} + ${fmtFlujo(ins.depositosAhorroCrecerPorMes[i])} = ${fmtFlujo(depositosAhorros[i])}.`),
    },
    {
      codigo: "", label: "Depósitos DPF", valores: ins.renovacionesDPFPorMes,
      formulas: porMes((i) => `Renovaciones de Depósito a Plazo Fijo del mes, del motor de Captaciones. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.renovacionesDPFPorMes[i])}.`),
    },
    {
      codigo: "", label: "Intereses Ganados inversiones/depósitos", valores: ins.interesesGanadosDepInvPorMes,
      formulas: porMes((i) => `Cuenta 51 del mes (todas las subcuentas menos 5104, que ya sale de Cartera) — mismo dato del mes que usa Proyección de Ingresos, sin acumular. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.interesesGanadosDepInvPorMes[i])}.`),
    },
    {
      codigo: "", label: "Aportes de Socios", valores: ins.aportesSociosPorMes,
      formulas: porMes((i) => `N° de socios nuevos del mes × Monto obligatorio de aporte — se edita en Patrimonio → 31 Certificados de Aportación, mismo dato que usa el rollforward de esa cuenta. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.aportesSociosPorMes[i])}.`),
    },
    {
      codigo: "", label: "Donaciones recibidas en efectivo (34)", valores: ins.donacionesEfectivoPorMes,
      formulas: porMes((i) => `Donaciones o aportes no reembolsables en efectivo del mes — se editan en Patrimonio → Otras cuentas y suben la cuenta 34. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.donacionesEfectivoPorMes[i])}.`),
    },
    {
      codigo: "", label: "Recuperación de préstamos", valores: ins.recuperacionCarteraEfectivaPorMes,
      formulas: porMes((i) => `Recuperación en efectivo de las 4 líneas de Cartera (Productivo, Consumo, Inmobiliario, Microcrédito), sumando cartera por vencer y en riesgo. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.recuperacionCarteraEfectivaPorMes[i])}.`),
    },
    {
      codigo: "", label: "Intereses ganados en crédito", valores: ins.interesesCarteraConMoraPorMes,
      formulas: porMes((i) => `Ingreso por interés de las 4 líneas de Cartera, con el 5% de relación de mora ya aplicado — mismo dato que alimenta la cuenta 5104 del Estado de Resultados. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.interesesCarteraConMoraPorMes[i])}.`),
    },
    {
      codigo: "", label: "Ingresos por comisiones (cta 52)", valores: ins.comisionesGanadasCarteraPorMes,
      formulas: porMes((i) => `Cuenta 52 — todavía no tiene ninguna cuenta mapeada en el motor, por eso sale en $0 en Matriz. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.comisionesGanadasCarteraPorMes[i])}.`),
    },
    {
      codigo: "", label: "Cuentas por cobrar", valores: cuentasPorCobrarFuente,
      formulas: porMes((i) => `- Variación del mes de la cuenta 16 (relación del balance de partida × cartera por vencer, ver Cuentas por cobrar). En ${NOMBRES_MES_FLUJO[i]}: -${fmtFlujo(ins.cuentasPorCobrarVariacionPorMes[i])} = ${fmtFlujo(cuentasPorCobrarFuente[i])}.`),
    },
    {
      codigo: "", label: "Créditos externos", valores: ins.creditosExternosNuevosPorMes,
      formulas: porMes(() => `Incrementos del mes de los 4 créditos externos del motor de Pasivo — $0 por política institucional (Matriz no toma créditos externos).`),
    },
    {
      codigo: "", label: "Transferencias internas recibidas", valores: ins.transferenciasInternasRecibidasPorMes,
      formulas: porMes((i) => `Incrementos de la cuenta 2908 (Pasivo) + disminuciones de la cuenta 1908 (Otros Activos) del mes. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.transferenciasInternasRecibidasPorMes[i])}.`),
    },
    {
      codigo: "", label: "Ingresos por servicios (cta 54)", valores: ins.ingresosPorServiciosPorMes,
      formulas: porMes((i) => `Cuenta 54 del mes — mismo dato del mes que usa Proyección de Ingresos, sin acumular. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.ingresosPorServiciosPorMes[i])}.`),
    },
    {
      codigo: "", label: "Otros ingresos (cta 53, 55, 56)", valores: ins.otrosIngresosTotalPorMes,
      formulas: porMes((i) => `Suma de las cuentas 53 (Utilidades Financieras) + 55 (Otros Ingresos Operacionales) + 56 (Otros Ingresos) del mes. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.otrosIngresosTotalPorMes[i])}.`),
    },
  ];

  const hijosUsos: NodoFlujoEfectivo[] = [
    {
      codigo: "", label: "Retiro de ahorros", valores: retiroAhorros,
      formulas: porMes((i) => `Retiros de Ahorro a la Vista + Retiros de Ahorro Crecer, del motor de Captaciones (siempre en positivo, es una salida de caja). En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(Math.abs(ins.retirosAhorroVistaPorMes[i]))} + ${fmtFlujo(Math.abs(ins.retirosAhorroCrecerPorMes[i]))} = ${fmtFlujo(retiroAhorros[i])}.`),
    },
    {
      codigo: "", label: "Retiro DPF", valores: retiroDPF,
      formulas: porMes((i) => `Cancelaciones de Depósito a Plazo Fijo del mes, del motor de Captaciones. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(retiroDPF[i])}.`),
    },
    {
      codigo: "", label: "Retiro Aporte de socios", valores: ins.retirosAporteSociosPorMes,
      formulas: porMes((i) => `N° de socios retirados del mes × Devolución promedio por socio — se edita en Patrimonio → Capital social, mismo dato que usa el rollforward de esa cuenta. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.retirosAporteSociosPorMes[i])}.`),
    },
    {
      codigo: "", label: "Intereses pagados por DPF", valores: ins.interesesPagadosDPFPorMes,
      formulas: porMes((i) => `Promedio entre saldo inicial y final de DPF × tasa DPF anual ÷ 12, del motor de Captaciones. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.interesesPagadosDPFPorMes[i])}.`),
    },
    {
      codigo: "", label: "Intereses pagados por créditos externos", valores: ins.interesesPagadosCreditosExternosPorMes,
      formulas: porMes(() => `Créditos externos en $0 por política institucional, así que sus intereses también son $0.`),
    },
    {
      codigo: "", label: "Gastos de personal", valores: ins.gastosDePersonalPorMes,
      formulas: porMes((i) => `Cuenta 4501 del mes — mismo dato del mes que usa Proyección de Egresos, sin acumular. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.gastosDePersonalPorMes[i])}.`),
    },
    {
      codigo: "", label: "Gastos operacionales", valores: ins.gastosOperacionalesEnEfectivoPorMes,
      formulas: porMes((i) => `Honorarios (4502) + Servicios Varios (4503) + Impuestos municipales y COSEDE (parte de 4504) + Otros gastos institucionales (parte de 4507) del mes — excluye Depreciación, Amortización, Suministros y Aportes SEPS por no ser salida real de caja. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.gastosOperacionalesEnEfectivoPorMes[i])}.`),
    },
    {
      codigo: "", label: "Adquisición de activos fijos", valores: ins.adquisicionActivosFijosPorMes,
      formulas: porMes((i) => `Adquisiciones del mes de las 7 categorías de Activo Fijo + Terrenos, del Plan de Adquisiciones (los revalúos no se incluyen: no son salida de efectivo). En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.adquisicionActivosFijosPorMes[i])}.`),
    },
    {
      codigo: "", label: "Pago de créditos externos", valores: ins.pagoCreditosExternosPorMes,
      formulas: porMes(() => `Créditos externos en $0 por política institucional, así que sus pagos también son $0.`),
    },
    {
      codigo: "", label: "Cuentas por pagar", valores: cuentasPorPagarUso,
      formulas: porMes((i) => `Pagos − incrementos de Cuentas por pagar (25) escritos en Pasivos: un pago sale de caja y un incremento (gasto aún no pagado) la deja. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(cuentasPorPagarUso[i])}.`),
    },
    {
      codigo: "", label: "Transferencias internas devueltas", valores: ins.transferenciasInternasDevueltasPorMes,
      formulas: porMes((i) => `Disminuciones de la cuenta 2908 (Pasivo) + incrementos de la cuenta 1908 (Otros Activos) del mes. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.transferenciasInternasDevueltasPorMes[i])}.`),
    },
    {
      codigo: "", label: "Nuevas inversiones de acciones", valores: ins.nuevasInversionesPorMes,
      formulas: porMes(() => `Cuenta 1901 sin movimiento en Matriz — siempre $0.`),
    },
    {
      codigo: "", label: "Pagos anticipados/gastos diferidos", valores: ins.nuevosPagosAnticipadosPorMes,
      formulas: porMes((i) => `Pagos anticipados del mes (cuenta 1904: pólizas de contado, cuotas iniciales y cuotas de pólizas pagadas en partes), del registro de Otros activos. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.nuevosPagosAnticipadosPorMes[i])}.`),
    },
    {
      codigo: "", label: "Adquisiciones materiales, mercadería", valores: ins.nuevasAdquisicionesMaterialesPorMes,
      formulas: porMes((i) => `Nuevas adquisiciones del mes, cuenta 1906, del motor de Otros Activos. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.nuevasAdquisicionesMaterialesPorMes[i])}.`),
    },
    {
      codigo: "", label: "Aportes al Fondo de Liquidez", valores: ins.ajusteFondoLiquidezPorMes,
      formulas: porMes((i) => `Ajuste mensual del Fondo de Liquidez, cuenta 1902 — mismo cálculo que puedes ver en detalle en Otros Activos. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.ajusteFondoLiquidezPorMes[i])}.`),
    },
    {
      codigo: "", label: "Aportes SEPS, comisiones, otros gastos, participación, impuesto a la renta y otros egresos", valores: ins.otrosEgresosEnEfectivoPorMes,
      formulas: porMes((i) => `Aportes SEPS (450415) + comisiones causadas (42) + otros gastos y pérdidas (47) + participación e impuesto a la renta (48) + otros egresos (41059005 interés de préstamos internos, 43, 46…), del presupuesto, pagados el mismo mes. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(ins.otrosEgresosEnEfectivoPorMes[i])}.`),
    },
  ];

  const saldoInicialPorMes = meses12((i) => m.flujoEfectivo[i].saldo_inicial);
  const fuentesPorMes = meses12((i) => m.flujoEfectivo[i].fuentes_de_capital);
  const usosPorMes = meses12((i) => m.flujoEfectivo[i].usos_de_capital);
  const reservasPorMes = meses12((i) => m.flujoEfectivo[i].reservas_de_liquidez_requeridas);
  const disponiblePorMes = meses12((i) => m.flujoEfectivo[i].disponible_para_creditos);
  const montoPrestamosPorMes = meses12((i) => m.flujoEfectivo[i].monto_prestamos_a_conceder);
  const saldoFinalPorMes = meses12((i) => m.flujoEfectivo[i].saldo_final);
  const totalCaptacionesPorMes = m.captaciones.totalMensual;

  return [
    {
      codigo: "", label: "SALDO INICIAL (Caja, Bancos, Inversiones)", valores: saldoInicialPorMes,
      formulas: porMes((i) => i === 0
        ? `Saldo real de Caja + Bancos + Inversiones al corte más reciente cargado de la agencia (Carga de datos). En enero: ${fmtFlujo(saldoInicialPorMes[0])}.`
        : `Saldo final de caja del mes anterior (${NOMBRES_MES_FLUJO[i - 1]}). En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(saldoInicialPorMes[i])}.`),
    },
    {
      codigo: "", label: "(+) FUENTES O INGRESOS DE CAPITAL", valores: fuentesPorMes, hijos: hijosFuentes,
      formulas: porMes((i) => `Suma de las 12 líneas de fuentes de abajo. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(fuentesPorMes[i])}.`),
    },
    {
      codigo: "", label: "(-) USOS DE CAPITAL", valores: usosPorMes, hijos: hijosUsos,
      formulas: porMes((i) => `Suma de las 16 líneas de usos de abajo. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(usosPorMes[i])}.`),
    },
    {
      codigo: "", label: "(-) RESERVAS DE LIQUIDEZ REQUERIDAS (ENCAJE BCE)", valores: reservasPorMes,
      formulas: porMes((i) => `Total de Captaciones del mes × ${pctTextoEncaje(saldos)} (encaje del Banco Central, editable en Fondos disponibles → Depósitos para encaje). En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(totalCaptacionesPorMes[i])} × ${pctTextoEncaje(saldos)} = ${fmtFlujo(reservasPorMes[i])}.`),
    },
    {
      codigo: "", label: "DISPONIBLE PARA CONCESIÓN DE CRÉDITOS", valores: disponiblePorMes,
      formulas: porMes((i) => `Saldo inicial + Fuentes − Usos − Reservas de liquidez. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(saldoInicialPorMes[i])} + ${fmtFlujo(fuentesPorMes[i])} − ${fmtFlujo(usosPorMes[i])} − ${fmtFlujo(reservasPorMes[i])} = ${fmtFlujo(disponiblePorMes[i])}.`),
    },
    {
      codigo: "", label: "MONTO DE PRÉSTAMOS A CONCEDER", valores: montoPrestamosPorMes,
      formulas: porMes((i) => `Suma de "Préstamos a conceder" de las 4 líneas de Cartera (Productivo, Consumo, Inmobiliario, Microcrédito), calculado a partir de la meta de colocación de la agencia. En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(montoPrestamosPorMes[i])}.`),
    },
    {
      codigo: "", label: "SALDO FINAL", valores: saldoFinalPorMes,
      formulas: porMes((i) => `Saldo inicial + Fuentes − Usos − Monto de préstamos a conceder (nota: esta fila usa el Monto a conceder, no las Reservas de liquidez). En ${NOMBRES_MES_FLUJO[i]}: ${fmtFlujo(saldoInicialPorMes[i])} + ${fmtFlujo(fuentesPorMes[i])} − ${fmtFlujo(usosPorMes[i])} − ${fmtFlujo(montoPrestamosPorMes[i])} = ${fmtFlujo(saldoFinalPorMes[i])}.`),
    },
    {
      // Cierre de liquidez (informativo): no cambia el saldo final; muestra si la colocación cabe en lo disponible.
      codigo: "", label: "SOBRANTE (FALTANTE) DE LIQUIDEZ", valores: meses12((i) => disponiblePorMes[i] - montoPrestamosPorMes[i]),
      formulas: porMes((i) => {
        const h = disponiblePorMes[i] - montoPrestamosPorMes[i];
        return `Disponible para concesión de créditos − Monto de préstamos a conceder = ${fmtFlujo(disponiblePorMes[i])} − ${fmtFlujo(montoPrestamosPorMes[i])} = ${fmtFlujo(h)}. `
          + (h >= 0 ? "Sobrante: la colocación cabe en la liquidez del mes, respetando el encaje."
            : "Faltante: para colocar la meta del mes se necesitan esos fondos adicionales (más captaciones, menos colocación o fondeo externo). Es informativo: el saldo final no cambia.");
      }),
    },
  ];
}

/**
 * Cuentas del corte que el presupuesto no lee (hojas del balance cargado con saldo que ninguna regla del motor usa).
 * Si alguna tiene saldo, el Balance proyectado no arranca igual al balance real y descuadra por ese valor.
 */
/**
 * Cuentas del corte que el motor no proyecta (grupos 12, 15, 22, 23, 26 y otros): se mantienen con su
 * saldo del corte los 12 meses, dentro de su grupo de dos dígitos. Antes quedaban fuera y el Balance
 * descuadraba todo el año por su suma. Modifica el balance recibido.
 */
export function incorporarCuentasNoLeidas(
  balance: { activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance },
  cuentas: { codigo: string; saldo: number }[],
  nombres: Record<string, string> = {},
  nombresGrupo: Record<string, string> = {},
): void {
  const raiz = { "1": balance.activo, "2": balance.pasivo, "3": balance.patrimonio } as Record<string, NodoBalance>;
  for (const c of cuentas) {
    const r = raiz[c.codigo[0]];
    if (!r) continue;
    const g = c.codigo.slice(0, 2);
    let grupo = (r.hijos ??= []).find((h) => h.codigo === g);
    if (!grupo) {
      grupo = { codigo: g, label: nombresGrupo[g] || `Grupo ${g}`, valores: Array(12).fill(0), hijos: [] };
      r.hijos.push(grupo);
      r.hijos.sort((a, b) => (/^\d+$/.test(a.codigo) && /^\d+$/.test(b.codigo) ? a.codigo.localeCompare(b.codigo) : 0));
    }
    grupo.valores = grupo.valores.map((v) => v + c.saldo);
    r.valores = r.valores.map((v) => v + c.saldo);
    // niveles intermedios del plan de cuentas (4 y 6 dígitos) hasta la cuenta, con todos sus dígitos
    let nodo = grupo;
    for (const l of [4, 6, 8, 10]) {
      if (l >= c.codigo.length) break;
      const k = c.codigo.slice(0, l);
      let sig = (nodo.hijos ??= []).find((h) => h.codigo === k);
      if (!sig) {
        sig = { codigo: k, label: nombres[k] || k, valores: Array(12).fill(0), hijos: [] };
        nodo.hijos.push(sig);
        nodo.hijos.sort((a, b) => (/^\d+$/.test(a.codigo) && /^\d+$/.test(b.codigo) ? a.codigo.localeCompare(b.codigo) : 0));
      }
      sig.valores = sig.valores.map((v) => v + c.saldo);
      nodo = sig;
    }
    (nodo.hijos ??= []).push({ codigo: c.codigo, label: nombres[c.codigo] || c.codigo, valores: Array(12).fill(c.saldo) });
    nodo.hijos.sort((a, b) => (/^\d+$/.test(a.codigo) && /^\d+$/.test(b.codigo) ? a.codigo.localeCompare(b.codigo) : 0));
  }
}

/**
 * Cuentas que el presupuesto mantiene igual al corte los 12 meses: su detalle real (subcuentas hasta 8 dígitos)
 * sigue siendo exacto, así que se muestra con los saldos del corte. Las cuentas que se mueven quedan al nivel en que
 * se proyectan (no se reparte nada entre subcuentas). Devuelve los códigos agregados, para buscar sus nombres.
 */
export function detallarCuentasSinMovimiento(
  balance: { activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance },
  saldos: SaldosPorCodigo,
  nombres: Record<string, string> = {},
): string[] {
  const cods = Object.keys(saldos).filter((k) => /^[123]\d+$/.test(k));
  const agregados: string[] = [];
  const hijosDe = (k: string) => {
    const debajo = cods.filter((c) => c !== k && c.startsWith(k));
    const minimo = Math.min(...debajo.map((c) => c.length));
    return debajo.filter((c) => c.length === minimo);
  };
  const armar = (k: string): NodoBalance[] => hijosDe(k).filter((c) => Math.abs(Number(saldos[c]) || 0) >= 0.005).map((c) => {
    agregados.push(c);
    const sub = armar(c);
    return { codigo: c, label: nombres[c] || c, valores: Array(12).fill(Number(saldos[c]) || 0), ...(sub.length ? { hijos: sub } : {}) };
  });
  const ir = (n: NodoBalance) => {
    if (n.hijos?.length) { n.hijos.forEach(ir); return; }
    if (!/^\d{2,}$/.test(n.codigo) || saldos[n.codigo] === undefined) return;
    const corte = Number(saldos[n.codigo]) || 0;
    if (!n.valores.every((v) => Math.abs(v - corte) < 0.01)) return;
    const sub = armar(n.codigo);
    if (sub.length) n.hijos = sub;
  };
  [balance.activo, balance.pasivo, balance.patrimonio].forEach(ir);
  return agregados;
}

/**
 * Cuentas que el motor proyecta y que en el balance del corte tienen UNA sola subcuenta con saldo (igual a la madre):
 * la subcuenta lleva los mismos 12 meses que la madre, hasta 8 dígitos (p. ej. 1908 → 190805, 1102 → 110205 → 11020505).
 * No reparte nada: si hay dos o más subcuentas con saldo, la cuenta se queda sin detalle.
 */
export function detallarSubcuentaUnica(balance: { activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance }, saldos: SaldosPorCodigo): string[] {
  const cods = Object.keys(saldos).filter((k) => /^[123]\d+$/.test(k) && Math.abs(Number(saldos[k]) || 0) >= 0.005);
  const agregados: string[] = [];
  const unica = (k: string): string | null => {
    const debajo = cods.filter((c) => c !== k && c.startsWith(k));
    if (!debajo.length) return null;
    const minimo = Math.min(...debajo.map((c) => c.length));
    const hijos = debajo.filter((c) => c.length === minimo);
    return hijos.length === 1 && minimo <= 8 && Math.abs((Number(saldos[hijos[0]]) || 0) - (Number(saldos[k]) || 0)) < 0.01 ? hijos[0] : null;
  };
  // una fila con un código que no es de su grupo (p. ej. la depreciación por bien, 1802… bajo 1899) no se detalla
  const ir = (n: NodoBalance, ancestro: string) => {
    const propio = /^\d+$/.test(n.codigo) && (!ancestro || n.codigo.startsWith(ancestro));
    if (n.hijos?.length) { n.hijos.forEach((h) => ir(h, propio ? n.codigo : ancestro)); return; }
    if (!propio || n.codigo.length < 2 || saldos[n.codigo] === undefined) return;
    let padre = n, h = unica(n.codigo);
    while (h) {
      agregados.push(h);
      const nodo: NodoBalance = { codigo: h, label: h, valores: [...n.valores] };
      padre.hijos = [nodo]; padre = nodo; h = unica(h);
    }
  };
  [balance.activo, balance.pasivo, balance.patrimonio].forEach((r) => ir(r, ""));
  return agregados;
}

export function cuentasNoLeidas(saldos: SaldosPorCodigo): { codigo: string; saldo: number }[] {
  const lineas = Object.values(CODIGOS_CARTERA).flatMap((l) => [...l.porVencer, ...l.enRiesgo]);
  const prov = [...Object.values(CODIGOS_PROVISION_CARTERA).flat(), CODIGO_PROVISION_GENERICA, "149987"];
  const af = ["1801", ...Object.values(CODIGO_AF).flatMap((x) => [x.costo, x.dep])];
  const leidas = [
    "11", "13", "16", "17", ...lineas, ...prov, ...af,
    "1901", "1902", "1904", "1905", "1906", "1908", "1990", "1999",
    "21", "25", "2908", "2990", "31", "33", "34", "35", "36",
  ];
  const cods = Object.keys(saldos).filter((k) => /^[123]\d{3,}$/.test(k));
  const hojas = cods.filter((k) => !cods.some((o) => o !== k && o.startsWith(k)));
  // una hoja se lee si su código empieza por una cuenta leída, o si es parte de una cuenta leída de más dígitos
  return hojas
    .filter((k) => !leidas.some((l) => k.startsWith(l)) && Math.abs(Number(saldos[k]) || 0) >= 0.5)
    .map((k) => ({ codigo: k, saldo: Number(saldos[k]) || 0 }));
}
