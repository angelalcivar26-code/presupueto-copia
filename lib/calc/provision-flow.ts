/**
 * Motor de cálculo puro - PROVISIÓN DE CARTERA POR FLOW RATES (tramos de mora)
 * Especificación: Especificacion_Modelo_Provision.md (calibrado ene-2025…sep-2026).
 *
 * Por agencia y producto, mes a mes:
 *   Tramo k (no V, no E): S_k(t) = (1 − 1/n_k)·S_k(t−1) + FR_k · S_{k−1}(t−1) / n_{k−1}
 *   Castigos(t)         = MIN(S_E(t−1), castigo mensual del producto en la agencia)
 *   Tramo E:              S_E(t) = S_E(t−1) − Castigos(t) + FR_E · S_{previo}(t−1) / n_previo
 *   Vigente:              S_V(t) = CarteraTotal(t) − Σ tramos en mora(t)
 *   Provisión(t)          = Σ_k S_k(t) · TasaEfectiva_k
 *   Gasto neto(t)         = Provisión(t) − Provisión(t−1) + Castigos(t)
 *                           > 0 → 4402 (gasto) · < 0 → 5604.10 (reversión, ingreso)
 *
 * Los % de migración (flow rates) son los de cada agencia, medidos con su propia Calificación de Cartera
 * (calibrarRitmoAgencia), en los mismos meses que la cooperativa; en los tramos con poco saldo, los de la cooperativa. Los % de provisión son los de la cooperativa.
 * El estado inicial es el último corte de Calificación de Cartera de la agencia.
 * Meses puente: del corte de calificación al corte del balance (el balance es el punto de partida de enero),
 * con la cartera total constante al corte.
 */

export type Producto = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";
export type Escenario = "optimista" | "base" | "pesimista";
export const PRODUCTOS: Producto[] = ["CONSUMO", "MICROCREDITO", "INMOBILIARIO", "PRODUCTIVO"];
export const ESCENARIOS: Escenario[] = ["optimista", "base", "pesimista"];
export const NOMBRE_ESCENARIO: Record<Escenario, string> = { optimista: "Optimista", base: "Base", pesimista: "Pesimista" };

/** Tramos por producto, en orden (V primero, E último). */
export const TRAMOS: Record<Producto, string[]> = {
  CONSUMO: ["V", "M1", "M2", "M3", "M4", "E"],
  MICROCREDITO: ["V", "M1", "M2", "M3", "M4", "E"],
  PRODUCTIVO: ["V", "M1", "M2", "M3", "M4", "E"],
  INMOBILIARIO: ["V", "A2", "A3", "B1", "B2", "C1", "C2", "D", "E"],
};
/** Tramos de entrada a la mora (los que mueve el factor Optimista / Pesimista). */
export const TRAMOS_ENTRADA: Record<Producto, string[]> = {
  CONSUMO: ["M1", "M2"], MICROCREDITO: ["M1", "M2"], PRODUCTIVO: ["M1", "M2"], INMOBILIARIO: ["A2", "A3"],
};
/** Tramos que cuentan como morosidad por días (>30 días; inmobiliario >60 días). */
const TRAMOS_MORA: Record<Producto, string[]> = {
  CONSUMO: ["M2", "M3", "M4", "E"], MICROCREDITO: ["M2", "M3", "M4", "E"], PRODUCTIVO: ["M2", "M3", "M4", "E"],
  INMOBILIARIO: ["B1", "B2", "C1", "C2", "D", "E"],
};
export const ETIQUETA_TRAMO: Record<Producto, Record<string, string>> = {
  CONSUMO: { V: "Vigente (A1)", M1: "1–30 días (A2+A3)", M2: "31–60 (B1+B2)", M3: "61–90 (C1+C2)", M4: "91–120 (D)", E: ">120 (E)" },
  MICROCREDITO: { V: "Vigente (A1)", M1: "1–30 días (A2+A3)", M2: "31–60 (B1+B2)", M3: "61–90 (C1+C2)", M4: "91–120 (D)", E: ">120 (E)" },
  PRODUCTIVO: { V: "Vigente (A1)", M1: "1–30 días (A2+A3)", M2: "31–60 (B1+B2)", M3: "61–90 (C1+C2)", M4: "91–120 (D)", E: ">120 (E)" },
  INMOBILIARIO: { V: "Vigente (A1)", A2: "1–30 (A2)", A3: "31–60 (A3)", B1: "61–120 (B1)", B2: "121–180 (B2)", C1: "181–210 (C1)", C2: "211–270 (C2)", D: "271–450 (D)", E: ">450 (E)" },
};
/** Subcuenta 4402 por producto. */
export const CUENTA_4402: Record<Producto, string> = { PRODUCTIVO: "440210", CONSUMO: "440220", INMOBILIARIO: "440230", MICROCREDITO: "440240" };

/** Categoría del reporte (A1…E) → tramo del modelo. Refinanciado y reestructurado van en su producto base. */
export function tramoDe(producto: Producto, cat: string): string | null {
  const c = cat.trim().toUpperCase();
  if (producto === "INMOBILIARIO") return c === "A1" ? "V" : TRAMOS.INMOBILIARIO.includes(c) ? c : null;
  const m: Record<string, string> = { A1: "V", A2: "M1", A3: "M1", B1: "M2", B2: "M2", C1: "M3", C2: "M3", D: "M4", E: "E" };
  return m[c] ?? null;
}
/** Rango de provisión de la norma por calificación (Codificación JPRF, gestión de riesgo de crédito COAC), en fracción. */
export const RANGO_NORMA: Record<string, [number, number]> = {
  A1: [0.01, 0.0199], A2: [0.02, 0.0299], A3: [0.03, 0.0599], B1: [0.06, 0.0999], B2: [0.10, 0.1999],
  C1: [0.20, 0.3999], C2: [0.40, 0.5999], D: [0.60, 0.9999], E: [1, 1],
};
/** Calificaciones que forman un tramo del modelo. */
export function categoriasDe(producto: Producto, tramo: string): string[] {
  if (producto === "INMOBILIARIO") return [tramo === "V" ? "A1" : tramo];
  return ({ V: ["A1"], M1: ["A2", "A3"], M2: ["B1", "B2"], M3: ["C1", "C2"], M4: ["D"], E: ["E"] } as Record<string, string[]>)[tramo] ?? [];
}
/** Rango de la norma de un tramo: si agrupa calificaciones, se pondera con el saldo de cada una (o en partes iguales si no hay saldo). */
export function rangoNormaTramo(producto: Producto, tramo: string, pesos?: Record<string, number>): [number, number] {
  const cats = categoriasDe(producto, tramo);
  const w = cats.map((c) => pesos?.[c] ?? 0); const tot = w.reduce((a, b) => a + b, 0);
  const f = (i: number) => (tot ? w[i] / tot : 1 / cats.length);
  return [cats.reduce((t, c, i) => t + f(i) * RANGO_NORMA[c][0], 0), cats.reduce((t, c, i) => t + f(i) * RANGO_NORMA[c][1], 0)];
}
/** "MICROCREDITO REFINANCIADO" → MICROCREDITO. */
export function productoDe(tipo: string): Producto | null {
  const p = tipo.trim().toUpperCase().split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (PRODUCTOS as string[]).includes(p) ? (p as Producto) : null;
}

export interface ParametroTramo {
  n: number; fr: Record<Escenario, number>; tasa: number;
  /** Recuperación de cartera vencida del presupuesto sobre la real (fracción mensual del saldo del tramo, puede ser negativa):
   *  lo que se cobra sale del tramo y libera su provisión (reversión), como lo registra la contabilidad. */
  rec?: number;
}
export type ParametrosFlow = Record<Producto, Record<string, ParametroTramo>>;

export interface ConfigFlow {
  castigoMensual: number;                         // USD, consolidado (por defecto 300.000)
  escenario: Escenario;                           // el que va al Balance, ER y Flujo
  recuperacionAnual: Record<Escenario, number>;   // recuperación de cartera castigada (5604.05), consolidado
  factorOptimista: number;                        // 0,80 sobre los tramos de entrada
  factorPesimista: number;                        // 1,25
  ventanaDesde: string;                           // "2026-06" (calibración del Base)
  ventanaHasta: string;                           // "2026-09"
  /** Ritmo de atraso: "agencia" = el de cada agencia; "cooperativa" = metodología anterior (el mismo para las 10). */
  ritmo?: "agencia" | "cooperativa";
  /** true: la ventana llega hasta el último corte de calificación cargado (ventanaHasta ya viene con ese mes). */
  ventanaAuto?: boolean;
}

/** Saldos de un corte por producto y tramo. */
export type SaldosTramo = Record<Producto, Record<string, number>>;

export interface ResultadoProducto {
  /** Saldos por tramo al cierre de cada mes del ejercicio (12). */
  saldos: Record<string, number[]>;
  total: number[];           // cartera total del modelo (presupuesto − castigos acumulados)
  castigos: number[];
  provision: number[];       // provisión requerida por tramos al cierre
  gastoNeto: number[];       // provisión − provisión anterior + castigos
  gasto4402: number[];       // parte positiva
  reversion: number[];       // parte negativa, en positivo (5604.10)
  mora: number[];            // saldo en tramos de mora por días (>30; inmobiliario >60)
  saldoE: number[];
  /** Provisión al inicio del ejercicio (después de los meses puente) y al corte de calificación. */
  provisionInicio: number;
  provisionCorte: number;
  castigosPuente: number;    // castigos de los meses puente (antes del ejercicio)
}
export type ResultadoFlow = Record<Producto, ResultadoProducto>;

const cero12 = () => Array(12).fill(0) as number[];

/**
 * Corre el modelo para una agencia (o el consolidado) y un escenario.
 * totalesEjercicio: cartera total presupuestada por producto (12 meses); null = constante al corte.
 * restarCastigos: true = cartera total del mes = presupuesto − castigos acumulados (integración);
 *                 false = como el Excel de calibración (cartera constante, el castigo lo absorbe el vigente).
 */
export function proyectarProvisionFlow(args: {
  parametros: ParametrosFlow;
  escenario: Escenario;
  inicial: SaldosTramo;                               // saldos al corte de calificación
  castigoMensualPorProducto: Record<Producto, number>; // monto del castigo de esta agencia y producto (antes del tope)
  mesesPuente: number;                               // meses entre el corte y el inicio del ejercicio
  totalesEjercicio: Record<Producto, number[]> | null;
  restarCastigos: boolean;
}): ResultadoFlow {
  const { parametros, escenario, inicial, castigoMensualPorProducto, mesesPuente, totalesEjercicio, restarCastigos } = args;
  const out = {} as ResultadoFlow;
  for (const p of PRODUCTOS) {
    const tr = TRAMOS[p];
    const par = tr.map((t) => parametros[p]?.[t] ?? { n: 1, fr: { optimista: 0, base: 0, pesimista: 0 }, tasa: 0 });
    let S = tr.map((t) => inicial[p]?.[t] ?? 0);
    const totalCorte = S.reduce((a, b) => a + b, 0);
    const prov = (x: number[]) => x.reduce((acc, s, k) => acc + s * (par[k].tasa || 0), 0);
    const provCorte = prov(S);
    let provAnt = provCorte;
    let castAcum = 0, castPuente = 0;
    const r: ResultadoProducto = {
      saldos: Object.fromEntries(tr.map((t) => [t, cero12()])), total: cero12(), castigos: cero12(), provision: cero12(),
      gastoNeto: cero12(), gasto4402: cero12(), reversion: cero12(), mora: cero12(), saldoE: cero12(),
      provisionInicio: provCorte, provisionCorte: provCorte, castigosPuente: 0,
    };
    const nMeses = Math.max(0, mesesPuente) + 12;
    for (let m = 0; m < nMeses; m++) {
      const ej = m - Math.max(0, mesesPuente); // mes del ejercicio (0..11) o negativo en los meses puente
      const N = Array(tr.length).fill(0) as number[];
      for (let k = 1; k < tr.length - 1; k++) {
        N[k] = (1 - 1 / par[k].n) * S[k] + par[k].fr[escenario] * S[k - 1] / par[k - 1].n;
      }
      const e = tr.length - 1;
      const castigo = Math.min(S[e], castigoMensualPorProducto[p] || 0);
      N[e] = S[e] - castigo + par[e].fr[escenario] * S[e - 1] / par[e - 1].n;
      // recuperación de vencida sobre la real: sale del tramo (la cartera total ya viene sin ella)
      for (let k = 1; k < tr.length; k++) if (par[k].rec) N[k] = Math.max(0, N[k] * (1 - par[k].rec!));
      castAcum += castigo;
      if (ej < 0) castPuente += castigo;
      const presupuesto = ej < 0 || !totalesEjercicio ? totalCorte : totalesEjercicio[p][ej];
      const total = restarCastigos ? presupuesto - castAcum : presupuesto;
      N[0] = total - N.slice(1).reduce((a, b) => a + b, 0);
      const pv = prov(N);
      const gasto = pv - provAnt + castigo;
      if (ej >= 0) {
        tr.forEach((t, k) => { r.saldos[t][ej] = N[k]; });
        r.total[ej] = total;
        r.castigos[ej] = castigo;
        r.provision[ej] = pv;
        r.gastoNeto[ej] = gasto;
        r.gasto4402[ej] = Math.max(0, gasto);
        r.reversion[ej] = Math.max(0, -gasto);
        r.mora[ej] = tr.reduce((acc, t, k) => acc + (TRAMOS_MORA[p].includes(t) ? N[k] : 0), 0);
        r.saldoE[ej] = N[e];
      } else if (ej === -1) {
        r.provisionInicio = pv;
      }
      provAnt = pv;
      S = N;
    }
    if (mesesPuente <= 0) r.provisionInicio = provCorte;
    r.castigosPuente = castPuente;
    out[p] = r;
  }
  return out;
}
export const CONCEPTO_FACTOR_MORA = "provision_factor_mora";

/** Ritmo real de la cartera de la agencia: pase a riesgo mensual por línea y recuperación de cartera vencida mensual. */
/**
 * rv: recuperación de vencida real sobre el SALDO en riesgo (la que usa el modelo); cv: la misma recuperación sobre las cuotas
 * vencidas del mes (la medida del reporte de recuperación, la que se escribe en el presupuesto); factorVencida = rv ÷ cv: convierte
 * el % del presupuesto (cuotas) al % del saldo que usan los motores.
 */
export interface ReferenciaCartera {
  pase: Partial<Record<Producto, number>>; rv: number | null; cv?: number | null; factorVencida?: number | null;
  /** Precancelaciones con dinero reales (sin refinanciamientos): q = % mensual de la cartera por vencer; qv = % mensual del saldo en riesgo. */
  q?: number | null; qv?: number | null;
  desde: string; hasta: string;
}

/** Factor para pasar la recuperación de vencida del presupuesto (% de las cuotas vencidas) al % del saldo en riesgo (1 sin reporte). */
export function factorVencidaDe(saldos: object): number {
  const f = provisionFlowDe(saldos)?.referencia?.factorVencida;
  return f && Number.isFinite(f) && f > 0 && f <= 1 ? f : 1;
}

/** Precancelaciones con dinero reales de la agencia (por vencer y en riesgo); null sin reporte de recuperación. */
export function precancelacionRealDe(saldos: object): { q: number; qv: number } | null {
  const r = provisionFlowDe(saldos)?.referencia;
  return r && r.q !== null && r.q !== undefined && r.q > 0 ? { q: r.q, qv: Math.max(0, r.qv ?? 0) } : null;
}

/** Supuestos de cartera de una versión por línea (promedio de los 12 meses): pase a riesgo equivalente y recuperación de vencida. */
export interface SupuestosMora { pase: Partial<Record<Producto, number>>; rv: Partial<Record<Producto, number>> }

/**
 * Cómo reacciona el modelo de provisión a los supuestos de cartera, frente al comportamiento real de la agencia:
 *  - Tramos de entrada a la mora × factor de mora de la agencia; la primera entrada (desde vigente) además × (pase a riesgo
 *    supuesto ÷ pase real), tope 0,2 – 3.
 *  - Recuperación de vencida: la diferencia (rv supuesta − rv real) sale cada mes de los tramos en riesgo (más de 30 días) y
 *    libera su provisión (así lo registra la contabilidad: el cobro de un crédito vencido revierte su provisión).
 * Con los supuestos iguales a lo real, el modelo queda como está calibrado.
 */
export function parametrosAgencia(base: ParametrosFlow, factorMora: number, sup: SupuestosMora | null, ref: ReferenciaCartera | null | undefined): ParametrosFlow {
  const fm = Number.isFinite(factorMora) && factorMora > 0 ? factorMora : 1;
  const lim = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const out = {} as ParametrosFlow;
  for (const p of Object.keys(base) as Producto[]) {
    const tr = TRAMOS[p] ?? [], ent = TRAMOS_ENTRADA[p] ?? [];
    const pr = ref?.pase?.[p], ps = sup?.pase?.[p];
    // el pase a riesgo mueve la primera entrada a la mora (desde vigente); el factor de mora, las dos entradas (como se calibró)
    const ratio = pr && pr > 0 && ps !== undefined ? lim(ps / pr, 0.2, 3) : 1;
    const rr = ref?.rv, rs = sup?.rv?.[p];
    // recuperación de vencida: lo que se cobra de más (o de menos) frente a lo real sale de los tramos en riesgo cada mes y libera
    // su provisión; el ritmo real ya está en los porcentajes calibrados, por eso solo entra la diferencia
    const rec = rr !== null && rr !== undefined && rs !== undefined ? lim(rs - rr, -0.5, 0.5) : 0;
    out[p] = {};
    tr.forEach((t) => {
      const x = base[p]?.[t]; if (!x) return;
      const f = ent.includes(t) ? fm * (t === ent[0] ? ratio : 1) : 1;
      const r = TRAMOS_MORA[p]?.includes(t) && Math.abs(rec) > 1e-12 ? rec : 0;
      out[p][t] = Math.abs(f - 1) < 1e-12 && !r ? x : { ...x, ...(r ? { rec: r } : {}), fr: { optimista: x.fr.optimista * f, base: x.fr.base * f, pesimista: x.fr.pesimista * f } };
    });
  }
  return out;
}
/** Factor de mora guardado para la agencia (promedio de los meses guardados; 1 si no hay). */
export function factorMoraDe(filas: { concepto: string; monto: number }[]): number {
  const x = filas.filter((f) => f.concepto === CONCEPTO_FACTOR_MORA);
  const v = x.length ? x.reduce((t, f) => t + (Number(f.monto) || 0), 0) / x.length : 1;
  return v > 0 ? v : 1;
}

/**
 * Calibración del factor de mora de una agencia con su historia de calificación (mes a mes):
 * entrada real a cada tramo de entrada = saldo del tramo − lo que se queda del mes anterior ((1 − 1/n) × saldo anterior);
 * entrada esperada = flow rate de la cooperativa (Base) × saldo del tramo previo ÷ su n. Factor = Σ real ÷ Σ esperada.
 */
export function calibrarFactorMora(parametros: ParametrosFlow, historia: { periodo: string; saldo: SaldosTramo }[]): { factor: number; desde: string; hasta: string; meses: number } | null {
  const h = [...historia].sort((a, b) => a.periodo.localeCompare(b.periodo)).slice(-13);
  let real = 0, esperada = 0, meses = 0;
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1].saldo, b = h[i].saldo; meses++;
    for (const p of PRODUCTOS) {
      const tr = TRAMOS[p];
      for (const t of TRAMOS_ENTRADA[p]) {
        const k = tr.indexOf(t); if (k <= 0) continue;
        const par = parametros[p]?.[t], prev = parametros[p]?.[tr[k - 1]]; if (!par || !prev) continue;
        const entra = (b[p]?.[t] ?? 0) - (1 - 1 / (par.n || 1)) * (a[p]?.[t] ?? 0);
        real += Math.max(0, entra);
        esperada += par.fr.base * (a[p]?.[tr[k - 1]] ?? 0) / (prev.n || 1);
      }
    }
  }
  if (meses < 3 || esperada <= 0) return null;
  return { factor: Math.min(3, Math.max(0.2, real / esperada)), desde: h[1].periodo, hasta: h[h.length - 1].periodo, meses };
}

// ---------------------------------------------------------------------
// Ritmo de atraso propio de cada agencia
// ---------------------------------------------------------------------

/** Saldo promedio mínimo del tramo anterior para usar el ritmo propio de la agencia; con menos, el de la cooperativa. */
export const LIMITE_RITMO_PROPIO = 50_000;
/** Meses (pares de cortes consecutivos) con los que se mide el ritmo de la agencia. */
export const MESES_RITMO = 12;

export interface RitmoTramo { fr: number; frCooperativa: number; propio: boolean; saldoPrevio: number }
export interface RitmoAgencia {
  desde: string; hasta: string; meses: number; limite: number;
  tramos: Record<Producto, Record<string, RitmoTramo>>;
}
export interface CorteAgencia { periodo: string; saldo: SaldosTramo; prov?: SaldosTramo }

const mesSiguiente = (p: string) => { const [a, m] = p.split("-").map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; };

/** Pares de cortes consecutivos (mes anterior, mes) de la historia, los últimos `meses`, hasta `hasta` inclusive. */
function paresConsecutivos(historia: CorteAgencia[], meses: number, hasta?: string): [CorteAgencia, CorteAgencia][] {
  const h = [...historia].filter((x) => !hasta || x.periodo <= hasta).sort((a, b) => a.periodo.localeCompare(b.periodo));
  const pares: [CorteAgencia, CorteAgencia][] = [];
  for (let i = 1; i < h.length; i++) if (h[i].periodo === mesSiguiente(h[i - 1].periodo)) pares.push([h[i - 1], h[i]]);
  return pares.slice(-meses);
}

/**
 * Ritmo de atraso de la agencia con su propia Calificación de Cartera (los mismos meses con que se calibra la cooperativa):
 *  - Tramos con atraso: % = Σ (saldo del tramo − lo que se queda del mes anterior) ÷ Σ saldo del tramo anterior el mes previo.
 *  - Tramo E: % = Σ (cambio del saldo E + castigos de la agencia) ÷ Σ saldo del tramo anterior, con los castigos del mes
 *    (gasto 4402 − reversión 5604.10 − cambio de la provisión), como en la cooperativa; los meses con castigo negativo
 *    (reclasificaciones de provisión) no se toman.
 * Si el tramo anterior tiene en promedio menos de LIMITE_RITMO_PROPIO, o el dato no sale entre 0 y 100 %, se usa el de la cooperativa.
 * Optimista y Pesimista mueven las entradas a la mora con los mismos factores de la cooperativa. Los % de provisión son los de la cooperativa.
 */
export function calibrarRitmoAgencia(args: {
  cooperativa: ParametrosFlow; historia: CorteAgencia[]; castigos?: Record<string, number>;
  factorOptimista: number; factorPesimista: number; limite?: number; meses?: number; hasta?: string;
}): { parametros: ParametrosFlow; ritmo: RitmoAgencia } | null {
  const { cooperativa, historia, castigos, factorOptimista, factorPesimista } = args;
  const limite = args.limite ?? LIMITE_RITMO_PROPIO;
  const pares = paresConsecutivos(historia, args.meses ?? MESES_RITMO, args.hasta);
  if (pares.length < 3) return null;
  const S = (c: CorteAgencia, p: Producto, k: string) => c.saldo[p]?.[k] ?? 0;
  const parametros = {} as ParametrosFlow;
  const tramos = {} as Record<Producto, Record<string, RitmoTramo>>;

  // Tramo E: un solo % para todos los productos (como la cooperativa), solo con los meses que tienen castigos de la agencia
  let frE: number | null = null, prevE = 0;
  {
    const conCastigo = pares.filter(([, b]) => castigos && Number.isFinite(castigos[b.periodo]) && castigos[b.periodo] >= 0);
    let num = 0, den = 0;
    for (const [a, b] of conCastigo) {
      for (const p of PRODUCTOS) {
        const tr = TRAMOS[p]; const e = tr[tr.length - 1], pe = tr[tr.length - 2];
        num += S(b, p, e) - S(a, p, e);
        den += S(a, p, pe) / (cooperativa[p]?.[pe]?.n || 1);
      }
      num += castigos![b.periodo];
    }
    prevE = conCastigo.length ? den / conCastigo.length : 0;
    const bruto = den > 0 ? num / den : NaN;
    if (conCastigo.length >= 3 && prevE >= limite && bruto >= 0 && bruto <= 1) frE = bruto;
  }

  for (const p of PRODUCTOS) {
    const tr = TRAMOS[p];
    parametros[p] = {}; tramos[p] = {};
    tr.forEach((k, idx) => {
      const coop = cooperativa[p]?.[k];
      if (!coop) return;
      if (idx === 0) { parametros[p][k] = coop; return; }
      const fc = coop.fr.base;
      let fr = fc, propio = false, saldoPrevio = 0;
      if (idx < tr.length - 1) {
        const nk = coop.n || 1, nPrev = cooperativa[p]?.[tr[idx - 1]]?.n || 1;
        let num = 0, den = 0;
        for (const [a, b] of pares) { num += S(b, p, k) - (1 - 1 / nk) * S(a, p, k); den += S(a, p, tr[idx - 1]) / nPrev; }
        saldoPrevio = den / pares.length;
        const bruto = den > 0 ? num / den : NaN;
        if (saldoPrevio >= limite && bruto >= 0 && bruto <= 1) { fr = bruto; propio = true; }
      } else {
        saldoPrevio = prevE;
        if (frE !== null) { fr = frE; propio = true; }
      }
      const entrada = TRAMOS_ENTRADA[p].includes(k);
      parametros[p][k] = {
        n: coop.n, tasa: coop.tasa,
        fr: !propio ? coop.fr : {
          base: fr,
          optimista: entrada ? clamp01(fr * factorOptimista) : fr,
          pesimista: entrada ? clamp01(fr * factorPesimista) : fr,
        },
      };
      tramos[p][k] = { fr, frCooperativa: fc, propio, saldoPrevio };
    });
  }
  return { parametros, ritmo: { desde: pares[0][1].periodo, hasta: pares[pares.length - 1][1].periodo, meses: pares.length, limite, tramos } };
}

/**
 * Castigos implícitos de la agencia por mes: (gasto 4402 − reversión 5604.10 del mes) − (provisión de la calificación del mes −
 * la del mes anterior). erMes: valores del mes (no acumulados).
 */
export function castigosImplicitos(historia: CorteAgencia[], erMes: Record<string, { g4402: number; r560410: number }>): Record<string, number> {
  const prov = (c: CorteAgencia) => PRODUCTOS.reduce((t, p) => t + Object.values(c.prov?.[p] ?? {}).reduce((a, b) => a + b, 0), 0);
  const out: Record<string, number> = {};
  for (const [a, b] of paresConsecutivos(historia, 1e6)) {
    const er = erMes[b.periodo];
    if (!er || !a.prov || !b.prov) continue;
    out[b.periodo] = er.g4402 - er.r560410 - (prov(b) - prov(a));
  }
  return out;
}

/**
 * Prueba del modelo con meses ya cerrados, como si se hubiera presupuestado: desde el corte real `desde`, se proyectan los
 * meses siguientes solo con los % (calibrados con datos hasta `desde`), la cartera total real de cada mes y los castigos reales.
 * Se compara el gasto neto de cada mes (4402 − 5604.10) y la provisión con lo real.
 */
export function probarProyeccion(args: {
  parametros: ParametrosFlow; historia: CorteAgencia[]; castigos: Record<string, number>; erMes: Record<string, { g4402: number; r560410: number }>;
  desde: string; meses: number;
}): { periodo: string; modelo: number; real: number; provModelo: number; provReal: number }[] {
  const { parametros, historia, castigos, erMes, desde } = args;
  const porPer = new Map(historia.map((c) => [c.periodo, c]));
  const c0 = porPer.get(desde);
  if (!c0?.prov) return [];
  const S = (c: CorteAgencia, p: Producto, k: string) => c.saldo[p]?.[k] ?? 0;
  const st = Object.fromEntries(PRODUCTOS.map((p) => [p, TRAMOS[p].map((k) => S(c0, p, k))])) as Record<Producto, number[]>;
  const provDe = (p: Producto, s: number[]) => TRAMOS[p].reduce((t, k, i) => t + s[i] * (parametros[p]?.[k]?.tasa ?? 0), 0);
  let provAnt = PRODUCTOS.reduce((t, p) => t + provDe(p, st[p]), 0);
  const out: { periodo: string; modelo: number; real: number; provModelo: number; provReal: number }[] = [];
  let per = desde;
  for (let m = 0; m < args.meses; m++) {
    per = mesSiguiente(per);
    const c = porPer.get(per), er = erMes[per], cast = castigos[per];
    if (!c?.prov || !er || !Number.isFinite(cast)) break;
    const eTot = PRODUCTOS.reduce((t, p) => t + st[p][st[p].length - 1], 0);
    let prov = 0;
    for (const p of PRODUCTOS) {
      const tr = TRAMOS[p], s = st[p], N = Array(tr.length).fill(0) as number[];
      const par = tr.map((k) => parametros[p]?.[k] ?? { n: 1, tasa: 0, fr: { optimista: 0, base: 0, pesimista: 0 } });
      for (let k = 1; k < tr.length - 1; k++) N[k] = (1 - 1 / par[k].n) * s[k] + par[k].fr.base * s[k - 1] / par[k - 1].n;
      const e = tr.length - 1;
      const ce = eTot > 0 ? cast * s[e] / eTot : 0;
      N[e] = Math.max(0, s[e] - ce + par[e].fr.base * s[e - 1] / par[e - 1].n);
      const total = tr.reduce((t, k) => t + S(c, p, k), 0);
      N[0] = total - N.slice(1).reduce((a, b) => a + b, 0);
      st[p] = N; prov += provDe(p, N);
    }
    const provReal = PRODUCTOS.reduce((t, p) => t + TRAMOS[p].reduce((a, k) => a + (c.prov?.[p]?.[k] ?? 0), 0), 0);
    out.push({ periodo: per, modelo: prov - provAnt + cast, real: er.g4402 - er.r560410, provModelo: prov, provReal });
    provAnt = prov;
  }
  return out;
}

/** Parte de la agencia en castigos y en recuperación de castigada, y de dónde sale. */
export interface RepartoAgencia {
  criterio: "real" | "saldoE";
  /** últimos 12 meses usados (AAAA-MM a AAAA-MM) cuando el criterio es real */
  desde: string | null; hasta: string | null;
  castigos: { parte: number; agencia: number | null; cooperativa: number | null };
  recuperacion: { parte: number; agencia: number | null; cooperativa: number | null };
  parteE: number;
}

/** Castigo mensual de una agencia por producto: castigo consolidado × (su saldo E ÷ E total consolidado). */
export function castigoPorProducto(castigoMensual: number, inicialAgencia: SaldosTramo, inicialConsolidado: SaldosTramo): Record<Producto, number> {
  const eTotal = PRODUCTOS.reduce((t, p) => t + (inicialConsolidado[p]?.E ?? 0), 0);
  return Object.fromEntries(PRODUCTOS.map((p) => [p, eTotal > 0 ? castigoMensual * (inicialAgencia[p]?.E ?? 0) / eTotal : 0])) as Record<Producto, number>;
}

/** Participación de la agencia en el saldo E consolidado (reparte la recuperación de castigada). */
export function participacionE(inicialAgencia: SaldosTramo, inicialConsolidado: SaldosTramo): number {
  const eTotal = PRODUCTOS.reduce((t, p) => t + (inicialConsolidado[p]?.E ?? 0), 0);
  const eAg = PRODUCTOS.reduce((t, p) => t + (inicialAgencia[p]?.E ?? 0), 0);
  return eTotal > 0 ? eAg / eTotal : 0;
}

/**
 * Meses que se avanzan antes de enero: del corte de calificación (AAAA-MM) al corte del balance.
 * El balance del corte es el punto de partida de enero (mismo criterio en todos los módulos), así que
 * solo se avanza si la calificación es más antigua que el balance. Sin corte de balance, hasta diciembre.
 */
export function mesesPuenteDe(periodoCorte: string, ejercicio: number, periodoBalance?: string): number {
  const [a, m] = periodoCorte.split("-").map(Number);
  if (periodoBalance) {
    const [ab, mb] = periodoBalance.split("-").map(Number);
    return Math.max(0, (ab - a) * 12 + (mb - m));
  }
  return Math.max(0, (ejercicio - 1 - a) * 12 + (12 - m));
}

// ---------------------------------------------------------------------
// Insumos que viajan pegados a los saldos de la agencia (como Inversiones y Fondos)
// ---------------------------------------------------------------------

export interface InsumosProvisionFlow {
  parametros: ParametrosFlow;
  config: ConfigFlow;
  periodoCorte: string;                 // corte de calificación usado como estado inicial
  inicial: SaldosTramo;                 // de la agencia
  provisionReporte: SaldosTramo;        // provisión del reporte al corte (informativa)
  castigoPorProducto: Record<Producto, number>;
  participacionE: number;               // parte de la agencia en la recuperación de castigada (5604.05)
  /** Cómo se repartieron entre agencias los castigos y la recuperación de castigada (metodología, para mostrar). */
  reparto?: RepartoAgencia;
  /** Ritmo de atraso propio de la agencia (null: la agencia usa el de la cooperativa); ya está en `parametros`. */
  ritmo?: RitmoAgencia | null;
  /** Factor de mora de la agencia calibrado con su calificación de cartera (ritmo real); el que se usa está en los parámetros. */
  factorMoraReal?: { factor: number; desde: string; hasta: string; meses: number } | null;
  /** Comportamiento real de la cartera de la agencia (referencia del modelo): pase a riesgo por línea y recuperación de vencida. */
  referencia?: ReferenciaCartera | null;
  /** 5604.10 ÷ 4402 real de la agencia (últimos 12 meses): reparte el gasto neto del modelo en gasto bruto (4402) y reversión (5604.10). */
  tasaReversion?: number;
  /** Gasto neto real al mes de la agencia (4402 − 5604.10) en la ventana sin alivio: el modelo se ajusta para reproducirlo. */
  gastoRealMes?: number | null;
  ejercicio: number;
  /** Corte del balance (AAAA-MM): punto de partida de enero. */
  periodoBalance?: string;
}
const porSaldos = new WeakMap<object, InsumosProvisionFlow>();
export function adjuntarProvisionFlow(saldos: object, i: InsumosProvisionFlow): void { porSaldos.set(saldos, i); }
export function provisionFlowDe(saldos: object): InsumosProvisionFlow | null { return porSaldos.get(saldos) ?? null; }

// ---------------------------------------------------------------------
// Recalibración (sección 3 de la especificación)
// ---------------------------------------------------------------------

export interface HistoriaTramos { saldo: Record<string, SaldosTramo>; prov: Record<string, SaldosTramo> }
export interface MesEERR { periodo: string; g4402: number; r560410: number; r560405: number }

interface Calibracion {
  parametros: ParametrosFlow;
  frEBruto: number | null;
  ventanaE: string[];
  castigoMensualSugerido: number | null;   // promedio de castigos implícitos en la ventana E
  tasaCastigo: number | null;              // c = Σ castigos / Σ S_E(t−1)
  periodosTasas: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function recalibrar(args: {
  historia: HistoriaTramos; eerr: MesEERR[]; ventanaDesde: string; ventanaHasta: string;
  factorOptimista: number; factorPesimista: number; parametrosActuales: ParametrosFlow;
}): Calibracion {
  const { historia, eerr, ventanaDesde, ventanaHasta, factorOptimista, factorPesimista, parametrosActuales } = args;
  const periodos = Object.keys(historia.saldo).sort();
  const anterior = (t: string) => { const i = periodos.indexOf(t); return i > 0 ? periodos[i - 1] : null; };
  const ventana = periodos.filter((t) => t >= ventanaDesde && t <= ventanaHasta && anterior(t));
  const S = (t: string, p: Producto, k: string) => historia.saldo[t]?.[p]?.[k] ?? 0;
  const PV = (t: string, p: Producto, k: string) => historia.prov[t]?.[p]?.[k] ?? 0;
  const n = (p: Producto, k: string) => parametrosActuales[p]?.[k]?.n ?? 1;

  // FR_E y castigos desde el estado de resultados: los meses de la ventana que tienen ER y calificación
  // (nunca antes de la ventana: si falta el ER del último mes, la ventana E es más corta, no toma meses con alivio).
  const mesesER = new Set(eerr.map((e) => e.periodo));
  const conER = periodos.filter((t) => mesesER.has(t) && anterior(t) && t >= ventanaDesde && t <= ventanaHasta);
  const ventanaE = conER.slice(-Math.max(1, ventana.length));
  const provTotal = (t: string) => PRODUCTOS.reduce((a, p) => a + TRAMOS[p].reduce((b, k) => b + PV(t, p, k), 0), 0);
  let numE = 0, denE = 0, sumCast = 0, sumSE = 0;
  for (const t of ventanaE) {
    const pt = anterior(t)!;
    const er = eerr.find((x) => x.periodo === t)!;
    const castigos = (er.g4402 - er.r560410) - (provTotal(t) - provTotal(pt));
    const dE = PRODUCTOS.reduce((a, p) => a + S(t, p, "E") - S(pt, p, "E"), 0);
    numE += dE + castigos;
    // Igual que la calibración del Excel: saldo del tramo previo sin dividir por n
    denE += PRODUCTOS.reduce((a, p) => a + S(pt, p, TRAMOS[p][TRAMOS[p].length - 2]), 0);
    sumCast += castigos;
    sumSE += PRODUCTOS.reduce((a, p) => a + S(pt, p, "E"), 0);
  }
  const frEBruto = denE > 0 ? numE / denE : null;
  const frE = frEBruto === null ? null : clamp01(frEBruto);

  // Tasas efectivas: provisión ÷ saldo, últimos 3 cortes (razón de sumas)
  const periodosTasas = periodos.filter((t) => t <= ventanaHasta).slice(-3);

  const parametros = {} as ParametrosFlow;
  for (const p of PRODUCTOS) {
    parametros[p] = {};
    TRAMOS[p].forEach((k, idx) => {
      const actual = parametrosActuales[p]?.[k];
      const nk = actual?.n ?? 1;
      let base = 0, bruto = 0;
      if (idx > 0 && idx < TRAMOS[p].length - 1) {
        let num = 0, den = 0;
        for (const t of ventana) {
          const pt = anterior(t)!;
          num += S(t, p, k) - (1 - 1 / nk) * S(pt, p, k);
          den += S(pt, p, TRAMOS[p][idx - 1]) / n(p, TRAMOS[p][idx - 1]);
        }
        bruto = den > 0 ? num / den : 0;
        base = clamp01(bruto);
      } else if (k === "E") {
        bruto = frE ?? actual?.fr.base ?? 0;
        base = frE ?? actual?.fr.base ?? 0;
      }
      const entrada = TRAMOS_ENTRADA[p].includes(k);
      let sSaldo = 0, sProv = 0;
      for (const t of periodosTasas) { sSaldo += S(t, p, k); sProv += PV(t, p, k); }
      const tasa = sSaldo > 0 ? sProv / sSaldo : actual?.tasa ?? 0;
      parametros[p][k] = {
        n: nk,
        fr: idx === 0 ? { optimista: 0, base: 0, pesimista: 0 } : {
          base,
          optimista: entrada ? clamp01(bruto * factorOptimista) : base,
          pesimista: entrada ? clamp01(bruto * factorPesimista) : base,
        },
        tasa,
      };
    });
  }
  return {
    parametros, frEBruto, ventanaE,
    castigoMensualSugerido: ventanaE.length ? sumCast / ventanaE.length : null,
    tasaCastigo: sumSE > 0 ? sumCast / sumSE : null,
    periodosTasas,
  };
}

/**
 * Backtest: corre el modelo sobre meses ya cerrados desde el saldo real del mes anterior,
 * con la cartera vigente real y la tasa de provisión vigente de cada mes, y compara con 4402 − 5604.10 real.
 * Los castigos de cada mes son los implícitos del ER, repartidos por producto según su saldo E.
 */
export function backtest(args: { historia: HistoriaTramos; eerr: MesEERR[]; parametros: ParametrosFlow; escenario: Escenario; desde: string; hasta: string }):
  { meses: { periodo: string; modelo: number; real: number }[]; modelo: number; real: number } {
  const { historia, eerr, parametros, escenario, desde, hasta } = args;
  const periodos = Object.keys(historia.saldo).sort();
  const meses = periodos.filter((t) => t >= desde && t <= hasta && periodos.indexOf(t) > 0 && eerr.some((e) => e.periodo === t));
  if (!meses.length) return { meses: [], modelo: 0, real: 0 };
  const S = (t: string, p: Producto, k: string) => historia.saldo[t]?.[p]?.[k] ?? 0;
  const PV = (t: string, p: Producto, k: string) => historia.prov[t]?.[p]?.[k] ?? 0;
  const provTotal = (t: string) => PRODUCTOS.reduce((a, p) => a + TRAMOS[p].reduce((b, k) => b + PV(t, p, k), 0), 0);
  const t0 = periodos[periodos.indexOf(meses[0]) - 1];
  const st = Object.fromEntries(PRODUCTOS.map((p) => [p, TRAMOS[p].map((k) => S(t0, p, k))])) as Record<Producto, number[]>;
  const provAnt = Object.fromEntries(PRODUCTOS.map((p) => [p, TRAMOS[p].reduce((a, k) => a + PV(t0, p, k), 0)])) as Record<Producto, number>;
  const salida: { periodo: string; modelo: number; real: number }[] = [];
  for (const t of meses) {
    const pt = periodos[periodos.indexOf(t) - 1];
    const er = eerr.find((x) => x.periodo === t)!;
    const real = er.g4402 - er.r560410;
    const castTotal = real - (provTotal(t) - provTotal(pt));
    const eTot = PRODUCTOS.reduce((a, p) => a + st[p][st[p].length - 1], 0);
    let modelo = 0;
    for (const p of PRODUCTOS) {
      const tr = TRAMOS[p]; const s = st[p]; const N = Array(tr.length).fill(0) as number[];
      const par = tr.map((k) => parametros[p][k]);
      for (let k = 1; k < tr.length - 1; k++) N[k] = (1 - 1 / par[k].n) * s[k] + par[k].fr[escenario] * s[k - 1] / par[k - 1].n;
      const e = tr.length - 1;
      const c = eTot > 0 ? castTotal * s[e] / eTot : 0;
      N[e] = s[e] - c + par[e].fr[escenario] * s[e - 1] / par[e - 1].n;
      N[0] = S(t, p, "V");
      const pv = tr.reduce((a, k, i) => a + N[i] * (S(t, p, k) ? PV(t, p, k) / S(t, p, k) : par[i].tasa), 0);
      modelo += pv - provAnt[p] + c;
      provAnt[p] = pv; st[p] = N;
    }
    salida.push({ periodo: t, modelo, real });
  }
  return { meses: salida, modelo: salida.reduce((a, x) => a + x.modelo, 0), real: salida.reduce((a, x) => a + x.real, 0) };
}

// ---------------------------------------------------------------------
// Ajuste del modelo al gasto real de la agencia
// ---------------------------------------------------------------------
/** Ritmo de atraso (flow rates de los tramos con atraso) multiplicado por k, sin pasar de 100 %. */
export function escalarRitmo(par: ParametrosFlow, k: number): ParametrosFlow {
  if (Math.abs(k - 1) < 1e-9) return par;
  const c = (x: number) => Math.max(0, Math.min(1, x * k));
  const out = {} as ParametrosFlow;
  for (const p of Object.keys(par) as Producto[]) {
    out[p] = {};
    TRAMOS[p]?.forEach((t, i) => { const x = par[p]?.[t]; if (!x) return; out[p][t] = i === 0 ? x : { ...x, fr: { optimista: c(x.fr.optimista), base: c(x.fr.base), pesimista: c(x.fr.pesimista) } }; });
  }
  return out;
}
/** Límites del ajuste: el ritmo de la agencia no se multiplica por menos de 0,2 ni por más de 3. */
export const AJUSTE_MIN = 0.2, AJUSTE_MAX = 3;
/**
 * Factor k del ritmo de atraso con el que el modelo, con la cartera de hoy (constante) y el comportamiento real de la agencia,
 * da su gasto neto real al mes. `gastoHoy(k)` = gasto del año del modelo con el ritmo × k. null sin gasto real.
 */
export function ajusteAlReal(gastoHoy: (k: number) => number, gastoRealMes: number | null | undefined): number | null {
  if (gastoRealMes === null || gastoRealMes === undefined || !Number.isFinite(gastoRealMes)) return null;
  const obj = gastoRealMes * 12;
  if (gastoHoy(AJUSTE_MAX) <= obj) return AJUSTE_MAX;
  if (gastoHoy(AJUSTE_MIN) >= obj) return AJUSTE_MIN;
  let lo = AJUSTE_MIN, hi = AJUSTE_MAX;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (gastoHoy(mid) < obj) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
