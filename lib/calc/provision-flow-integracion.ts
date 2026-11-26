/**
 * Integración del modelo de provisión por flow rates con los motores de la agencia
 * (Cartera → Balance 14 y 1499, ER 4402 / 5604.10 / 5604.05, Flujo).
 *
 *  - La cartera total del modelo = cartera presupuestada (motor de Cartera) − castigos acumulados.
 *  - Los castigos salen solo del tramo E: restan de la cartera en riesgo (14) y de la provisión (1499)
 *    por el mismo monto (débito provisión, crédito cartera).
 *  - 1499 de cada línea = su saldo real del balance de partida + (provisión del modelo − provisión del
 *    modelo al inicio del ejercicio). La diferencia de partida ("provisión no explicada por tramos":
 *    genérica, voluntaria o de intereses) queda constante todo el año.
 *  - Gasto neto = provisión − provisión anterior + castigos: > 0 → 4402 por producto; < 0 → 5604.10.
 *  - Recuperación de castigada (5604.05) = supuesto anual del escenario × participación de la agencia
 *    en el saldo E ÷ 12; entra como efectivo (Flujo) e ingreso (56).
 */
import {
  ESCENARIOS, proyectarProvisionFlow, provisionFlowDe, mesesPuenteDe, CUENTA_4402, PRODUCTOS, parametrosAgencia, escalarRitmo, ajusteAlReal, type SupuestosMora,
  type Escenario, type Producto, type ResultadoFlow, type ParametrosFlow, type ConfigFlow,
} from "./provision-flow";

type LineaCartera = {
  porVencer: { saldoInicial: number; saldoFinal: number }[];
  enRiesgo: { saldoInicial: number; saldoFinal: number; detalle?: Record<string, number> }[];
};

export interface LineaProvisionFlow {
  cuenta4402: string;
  saldo1499: number[];        // provisión del Balance (positivo) al cierre de cada mes
  noExplicada: number;        // saldo real del corte − provisión por tramos al inicio del ejercicio (constante)
  gastoNeto: number[];
  gasto4402: number[];
  reversion: number[];
  castigos: number[];
  castigosAcumulados: number[];
}

export interface ResumenEscenario {
  resultado: ResultadoFlow;   // por producto: tramos, provisión del modelo, gasto, castigos, mora, saldo E…
  recuperacion: number[];     // 5604.05 de la agencia, por mes
}

export interface ProvisionFlowAgencia {
  escenario: Escenario;
  config: ConfigFlow;
  periodoCorte: string;
  mesesPuente: number;
  porLinea: Record<Producto, LineaProvisionFlow>;
  recuperacion: number[];     // escenario activo
  reversion: number[];        // total, escenario activo
  escenarios: Record<Escenario, ResumenEscenario>;
  /** Insumos para simular en pantalla (Provisiones → Simulador): estado inicial, castigos y cartera presupuestada. */
  simulacion: { inicial: Record<Producto, Record<string, number>>; castigoPorProducto: Record<Producto, number>; totales: Record<Producto, number[]>; participacionE: number; parametros: ParametrosFlow;
    /** Sin mejoras: el ritmo propio de la agencia con su pase a riesgo y recuperación reales y sin meta (factor 1). */
    parametrosSinMejoras: ParametrosFlow;
    /** Puente de la provisión, un cambio a la vez: solo el pase a riesgo del presupuesto; pase y recuperación del presupuesto
     *  (sin meta). Con la meta son `parametros`. */
    parametrosSoloPase: ParametrosFlow; parametrosCartera: ParametrosFlow };
  /** Mismo cálculo con cartera constante al corte (el del Excel de calibración), para comparar. */
  controlConstante: Record<Escenario, { gasto: number; provisionDic: number }>;
  /** Ajuste al real: factor del ritmo de atraso (null sin gasto real) y el gasto real al mes que reproduce. */
  ajuste: { factor: number | null; gastoRealMes: number | null };
}

const sumar = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));

export function calcularProvisionFlowAgencia(
  saldos: object,
  lineasNombres: Producto[],
  lineasCartera: LineaCartera[],
  saldoCorte1499: (linea: Producto) => number,
  factorMora = 1,
  supuestos: SupuestosMora | null = null,
): ProvisionFlowAgencia | null {
  const insR = provisionFlowDe(saldos);
  if (!insR) return null;
  const mesesPuente = mesesPuenteDe(insR.periodoCorte, insR.ejercicio, insR.periodoBalance);
  // Ajuste al real: el ritmo de atraso de la agencia se multiplica por k para que el modelo, con la cartera de hoy y su
  // comportamiento real (sin mejoras ni meta), dé su gasto neto real al mes de la ventana sin alivio. Así el presupuesto
  // parte de lo que hoy provisiona la agencia; lo que cambia después es solo la cartera 2027 y las mejoras.
  const gastoHoy = (k: number) => {
    const r = proyectarProvisionFlow({ parametros: parametrosAgencia(escalarRitmo(insR.parametros, k), 1, null, insR.referencia), escenario: insR.config.escenario,
      inicial: insR.inicial, castigoMensualPorProducto: insR.castigoPorProducto, mesesPuente, totalesEjercicio: null, restarCastigos: false });
    return PRODUCTOS.reduce((t, p) => t + (r[p]?.gastoNeto ?? []).reduce((a, b) => a + b, 0), 0);
  };
  const ajuste = ajusteAlReal(gastoHoy, insR.gastoRealMes);
  const ins0 = ajuste === null ? insR : { ...insR, parametros: escalarRitmo(insR.parametros, ajuste) };
  // factor de mora de la agencia y supuestos de cartera (pase a riesgo, recuperación de vencida) frente a lo real
  const ins = { ...ins0, parametros: parametrosAgencia(ins0.parametros, factorMora, supuestos, ins0.referencia) };
  const totales = Object.fromEntries(lineasNombres.map((l, idx) => [
    l, Array.from({ length: 12 }, (_, i) => lineasCartera[idx].porVencer[i].saldoFinal + lineasCartera[idx].enRiesgo[i].saldoFinal),
  ])) as Record<Producto, number[]>;

  const correr = (e: Escenario, constante: boolean) => proyectarProvisionFlow({
    parametros: ins.parametros, escenario: e, inicial: ins.inicial, castigoMensualPorProducto: ins.castigoPorProducto,
    mesesPuente, totalesEjercicio: constante ? null : totales, restarCastigos: !constante,
  });
  const recuperacionDe = (e: Escenario) => Array(12).fill((ins.config.recuperacionAnual[e] || 0) * ins.participacionE / 12) as number[];
  // Gasto bruto y reversión como los registra la contabilidad: con la reversión real de la agencia (r = 5604.10 ÷ 4402),
  // cada mes con gasto neto N > 0 se registra 4402 = N ÷ (1 − r) y 5604.10 = r × N ÷ (1 − r). El neto (y la utilidad,
  // la provisión y el flujo) no cambia.
  const r = Math.max(0, Math.min(0.3, ins.tasaReversion ?? 0)), k = r / (1 - r);
  const bruto = (res: ResultadoFlow) => {
    if (k <= 0) return res;
    for (const p of PRODUCTOS) {
      const x = res[p]; if (!x) continue;
      x.gasto4402 = x.gasto4402.map((g) => g * (1 + k));
      x.reversion = x.reversion.map((v, i) => v + x.gasto4402[i] * r);
    }
    return res;
  };
  const escenarios = Object.fromEntries(ESCENARIOS.map((e) => [e, { resultado: bruto(correr(e, false)), recuperacion: recuperacionDe(e) }])) as Record<Escenario, ResumenEscenario>;
  const controlConstante = Object.fromEntries(ESCENARIOS.map((e) => {
    const r = correr(e, true);
    return [e, {
      gasto: PRODUCTOS.reduce((t, p) => t + r[p].gastoNeto.reduce((a, b) => a + b, 0), 0),
      provisionDic: PRODUCTOS.reduce((t, p) => t + r[p].provision[11], 0),
    }];
  })) as Record<Escenario, { gasto: number; provisionDic: number }>;

  const esc = ins.config.escenario;
  const activo = escenarios[esc].resultado;
  const porLinea = {} as Record<Producto, LineaProvisionFlow>;
  lineasNombres.forEach((l, idx) => {
    const r = activo[l];
    // El castigo sale de la cartera en riesgo (tramo E): la cartera bruta baja por el acumulado.
    // Nunca se castiga más de lo que hay en riesgo: lo que exceda no se castiga y se queda en la
    // provisión (el asiento de castigo es provisión contra cartera; sin cartera no hay asiento).
    // El gasto del mes no cambia: gasto = provisión − anterior + castigos se mantiene.
    const er = lineasCartera[idx].enRiesgo;
    // La cartera en riesgo se rehace mes a mes con los castigos: lo castigado ya no está, así que la recuperación de vencida
    // (y sus precancelaciones) se aplica sobre el saldo que queda, no sobre el saldo sin castigar (antes se restaba el
    // acumulado al final y la recuperación se calculaba también sobre lo ya castigado).
    const castigos: number[] = [], acum: number[] = [], noCastigado: number[] = [];
    let a = 0, exceso = 0, R = er[0]?.saldoInicial ?? 0;
    for (let i = 0; i < 12; i++) {
      const d = er[i].detalle as { incrementosRiesgo?: number; recuperacionRiesgo?: number; recuperacionNeta?: number; precancelaciones?: number };
      const ini0 = er[i].saldoInicial;
      const tasa = ini0 > 0 ? (d.recuperacionRiesgo ?? 0) / ini0 : 0;          // rv + precancelación de vencida del mes
      const parteNeta = (d.recuperacionRiesgo ?? 0) > 0 ? (d.recuperacionNeta ?? 0) / (d.recuperacionRiesgo ?? 1) : 1;
      const sale = R * tasa, entra = d.incrementosRiesgo ?? 0;
      const disponible = Math.max(0, R + entra - sale);
      const c = Math.max(0, Math.min(r.castigos[i] ?? 0, disponible));
      exceso += (r.castigos[i] ?? 0) - c;
      castigos.push(c); a += c; acum.push(a); noCastigado.push(exceso);
      er[i].saldoInicial = R;
      er[i].saldoFinal = R + entra - sale - c;
      er[i].detalle = { ...er[i].detalle, recuperacionRiesgo: sale, recuperacionNeta: sale * parteNeta, precancelaciones: sale * (1 - parteNeta) };
      R = er[i].saldoFinal;
    }
    const corte = saldoCorte1499(l);
    const noExplicada = corte - r.provisionInicio;
    porLinea[l] = {
      cuenta4402: CUENTA_4402[l],
      saldo1499: r.provision.map((p, i) => p + noExplicada + noCastigado[i]),
      noExplicada,
      gastoNeto: [...r.gastoNeto], gasto4402: [...r.gasto4402], reversion: [...r.reversion],
      castigos, castigosAcumulados: acum,
    };
  });
  return {
    escenario: esc, config: ins.config, periodoCorte: ins.periodoCorte, mesesPuente, porLinea, ajuste: { factor: ajuste, gastoRealMes: insR.gastoRealMes ?? null },
    recuperacion: escenarios[esc].recuperacion,
    reversion: lineasNombres.reduce((t, l) => sumar(t, porLinea[l].reversion), Array(12).fill(0) as number[]),
    escenarios, controlConstante,
    simulacion: { inicial: ins.inicial, castigoPorProducto: ins.castigoPorProducto, totales, participacionE: ins.participacionE, parametros: ins.parametros,
      parametrosSinMejoras: parametrosAgencia(ins0.parametros, 1, null, ins0.referencia),
      parametrosSoloPase: parametrosAgencia(ins0.parametros, 1, supuestos ? { pase: supuestos.pase, rv: {} } : null, ins0.referencia),
      parametrosCartera: parametrosAgencia(ins0.parametros, 1, supuestos, ins0.referencia) },
  };
}

/** Quita del presupuesto departamental 5604.05 y 5604.10 (con el modelo, las calcula la provisión). */
export function filasSinRecuperaciones<T extends { concepto: string }>(filas: T[]): T[] {
  return filas.filter((f) => !/^5604(05|10)/.test(f.concepto.replace(/\D/g, "")));
}
