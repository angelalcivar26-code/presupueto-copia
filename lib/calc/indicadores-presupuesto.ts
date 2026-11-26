import { solvencia } from "./solvencia";

/**
 * INDICADORES DEL PRESUPUESTO: los indicadores de la herramienta de indicadores financieros (mismas fórmulas) calculados
 * con el Balance general y el Estado de resultados PROYECTADOS de cada agencia. Sin metas ni clasificación: solo el valor.
 *
 * Convenciones (las de la herramienta de indicadores):
 *  - Utilidad = 5 − 4 (acumulado del año). Anualización: × 12 ÷ mes (diciembre = 1).
 *  - Activo real = 1 − 1908 (en el Consolidado no se resta: las transferencias internas se compensan entre oficinas).
 *  - Promedio del activo y del patrimonio (ROA, ROE, gastos ÷ activo): desde diciembre del año anterior hasta el mes,
 *    dividido para mes + 1. Diciembre anterior = balance de partida del presupuesto (corte). En diciembre, ROA y ROE
 *    usan el saldo de diciembre, sin promedio.
 *  - Patrimonio del ROE: la cuenta 3 sin el resultado del año (así viene en el balance durante el año); en diciembre, con él.
 *  - Promedio de la cartera (gastos ÷ cartera, costo de riesgo): de enero al mes.
 *  - Activos productivos: 1103 + 12 + 13 + cartera por vencer + 1901 + 1902 productiva (190205, 190210, 190215, 190220,
 *    190280, 190286). Improductivos: 11 − 1103 + cartera en riesgo + 1499 + 16 + 17 + 18 + (19 − menor entre 1908 y 2908)
 *    − 1901 − 1902 productiva. La parte no productiva de la 1902 se mantiene con su saldo del corte.
 *  - Fondos disponibles ÷ depósitos: 11 ÷ (2101 + 2103). Las demás cuentas de la 21 se mantienen con su saldo del corte.
 *  - Cartera "14" = cartera neta del balance (con la provisión 1499), como en la herramienta de indicadores.
 * Lo que necesita cuentas de orden, contingentes o subcuentas por plazo (solvencia, liquidez estructural, liquidez
 * corriente con DPF a 30/90 días) no se calcula: el presupuesto no proyecta esas cuentas.
 */

export type Linea = "consumo" | "microcredito" | "inmobiliario" | "productivo";
export const LINEAS: { k: Linea; n: string }[] = [
  { k: "consumo", n: "Consumo" }, { k: "microcredito", n: "Microcrédito" }, { k: "inmobiliario", n: "Inmobiliario" }, { k: "productivo", n: "Productivo" },
];

/** Cantidades base de una agencia: 12 valores (saldos del balance al cierre de cada mes; resultados acumulados del año). */
export interface Base {
  activo: number[]; a1908: number[]; a11: number[]; a1103: number[]; a13: number[]; a14: number[];
  porVencer: number[]; enRiesgo: number[]; pvLinea: Record<Linea, number[]>; riLinea: Record<Linea, number[]>;
  a1499: number[]; a16: number[]; a17: number[]; a18: number[]; a19: number[]; a1901: number[]; a1902: number[];
  p21: number[]; depositos: number[]; dpf: number[]; p29: number[]; p2908: number[]; patrimonio: number[];
  i5: number[]; i51: number[]; i5104: number[]; i5190: number[]; i52: number[]; i53: number[]; i54: number[]; i55: number[]; i56: number[];
  e4: number[]; e41: number[]; e41059005: number[]; e42: number[]; e43: number[]; e44: number[]; e45: number[];
  e4501: number[]; e4502: number[]; e4503: number[]; e4504: number[]; e4505: number[]; e4506: number[]; e4507: number[];
  e47: number[]; e48: number[]; a12: number[];
  /** balance de partida (diciembre anterior), en la posición 0 */
  c1: number[]; c1908: number[]; c3: number[];
  /** saldos del corte que no se proyectan: 1902 no productiva y la 21 que no es 2101 ni 2103 */
  c1902NoProd: number[]; c21NoDep: number[];
  solv?: BaseSolvencia;
  consolidado?: boolean;
  /** base armada con cifras reales: el patrimonio ya viene sin el resultado del año */
  real?: boolean;
}

/** Saldos del balance de partida que usan los indicadores (los devuelve /api/balance-general en «corte»). */
export const CODIGOS_CORTE = ["1", "1908", "3", "1902", "190205", "190210", "190215", "190220", "190280", "190286", "21", "2101", "2103",
  // solvencia: subcuentas que el presupuesto no proyecta aparte (se mantienen con su saldo del corte)
  "1301", "1302", "1303", "1304", "1305", "1306", "1307", "1408", "1411", "1419", "1619", "199005", "2801",
  "3201", "3202", "3301", "3303", "3304", "3305", "330115", "3601", "3602", "3603", "3604"];
/** Contingentes y cuentas de orden que usa la solvencia (del archivo de cuentas de orden del mes de corte). */
export const CODIGOS_CORTE_ORDEN = ["64", "6404", "640410", "640505", "7108"];

/** Lo que la solvencia presupuestada necesita además de la base (saldos del corte y cuentas proyectadas). */
export interface BaseSolvencia {
  corte: Record<string, number>; orden: Record<string, number> | null; resultadoCorte: number;
  inv: Record<string, number[]>; n31: number[]; n35: number[];
}

interface Nodo { codigo?: string; label?: string; valores?: number[]; hijos?: Nodo[] }
const cero = () => Array(12).fill(0) as number[];
const v12 = (n: Nodo | null | undefined) => (n?.valores?.length ? n.valores.map((x) => Number(x) || 0) : cero());
function buscar(n: Nodo | null | undefined, codigo: string): Nodo | null {
  if (!n) return null;
  if (n.codigo === codigo) return n;
  for (const h of n.hijos ?? []) { const r = buscar(h, codigo); if (r) return r; }
  return null;
}
const porEtiqueta = (n: Nodo | null | undefined, etiqueta: string) => (n?.hijos ?? []).find((h) => (h.label ?? "").toLowerCase().startsWith(etiqueta.toLowerCase())) ?? null;
const sinTilde = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const lineaDe = (label: string): Linea | null => {
  const s = sinTilde(label);
  return s.includes("consumo") ? "consumo" : s.includes("micro") ? "microcredito" : s.includes("inmob") || s.includes("vivienda") ? "inmobiliario" : s.includes("productiv") ? "productivo" : null;
};

/** Arma la base de una agencia con las respuestas de /api/balance-general y /api/estado-resultados (valores acumulados). */
export function baseDe(bal: { activo?: Nodo; pasivo?: Nodo; patrimonio?: Nodo; corte?: Record<string, number>; corteOrden?: Record<string, number> | null; resultadoCorte?: number }, er: { ingresos?: Nodo; egresos?: Nodo }): Base {
  const c = (k: string) => Number(bal.corte?.[k]) || 0;
  const prod1902 = ["190205", "190210", "190215", "190220", "190280", "190286"].reduce((t, k) => t + c(k), 0);
  const A = bal.activo, P = bal.pasivo, PT = bal.patrimonio, I = er.ingresos, E = er.egresos;
  const n14 = buscar(A, "14");
  const pv = porEtiqueta(n14, "Cartera por Vencer"), ri = porEtiqueta(n14, "Cartera en Riesgo");
  const porLinea = (n: Nodo | null) => {
    const o = { consumo: cero(), microcredito: cero(), inmobiliario: cero(), productivo: cero() } as Record<Linea, number[]>;
    for (const h of n?.hijos ?? []) { const l = lineaDe(h.label ?? ""); if (l) v12(h).forEach((x, i) => { o[l][i] += x; }); }
    return o;
  };
  const n21 = buscar(P, "21");
  const dep = ["Vista", "Crecer", "DPF"].map((c) => v12(buscar(n21, c)));
  return {
    activo: v12(A), a1908: v12(buscar(A, "1908")), a11: v12(buscar(A, "11")), a1103: v12(buscar(A, "1103")), a13: v12(buscar(A, "13")), a14: v12(n14),
    porVencer: v12(pv), enRiesgo: v12(ri), pvLinea: porLinea(pv), riLinea: porLinea(ri),
    a1499: v12(buscar(A, "1499")), a16: v12(buscar(A, "16")), a17: v12(buscar(A, "17")), a18: v12(buscar(A, "18")), a19: v12(buscar(A, "19")),
    a1901: v12(buscar(A, "1901")), a1902: v12(buscar(A, "1902")),
    p21: v12(n21), depositos: cero().map((_, i) => dep[0][i] + dep[1][i] + dep[2][i]), dpf: dep[2], p29: v12(buscar(P, "29")), p2908: v12(buscar(P, "2908")), patrimonio: v12(PT),
    i5: v12(I), i51: v12(buscar(I, "51")), i5104: v12(buscar(I, "5104")), i5190: v12(buscar(I, "5190")), i52: v12(buscar(I, "52")),
    i53: v12(buscar(I, "53")), i54: v12(buscar(I, "54")), i55: v12(buscar(I, "55")), i56: v12(buscar(I, "56")),
    e4: v12(E), e41: v12(buscar(E, "41")), e41059005: v12(buscar(E, "41059005")), e42: v12(buscar(E, "42")), e43: v12(buscar(E, "43")),
    e44: v12(buscar(E, "44")), e45: v12(buscar(E, "45")),
    e4501: v12(buscar(E, "4501")), e4502: v12(buscar(E, "4502")), e4503: v12(buscar(E, "4503")), e4504: v12(buscar(E, "4504")),
    e4505: v12(buscar(E, "4505")), e4506: v12(buscar(E, "4506")), e4507: v12(buscar(E, "4507")),
    e47: v12(buscar(E, "47")), e48: v12(buscar(E, "48")), a12: v12(buscar(A, "12")),
    c1: [c("1")], c1908: [c("1908")], c3: [c("3")],
    c1902NoProd: [c("1902") ? c("1902") - prod1902 : 0], c21NoDep: [c("21") ? c("21") - c("2101") - c("2103") : 0],
    solv: {
      corte: Object.fromEntries(CODIGOS_CORTE.map((k) => [k, c(k)])), orden: bal.corteOrden ?? null, resultadoCorte: Number(bal.resultadoCorte) || 0,
      // inversiones por subcuenta cuando el presupuesto las proyecta (registro de títulos); si no, saldo del corte
      inv: Object.fromEntries(["1301", "1302", "1303", "1304", "1305", "1306", "1307"].map((k) => {
        const hijos = (buscar(A, "13")?.hijos ?? []).filter((h) => (h.codigo ?? "").startsWith(k));
        return [k, hijos.length ? cero().map((_, i) => hijos.reduce((t, h) => t + v12(h)[i], 0)) : cero().map(() => c(k))];
      })),
      n31: v12(buscar(PT, "31")), n35: v12(buscar(PT, "35")),
    },
  };
}

/** Consolidado = suma de las bases de las agencias (las transferencias internas no se restan del activo). */
export function sumarBases(bases: Base[]): Base {
  const s = (f: (b: Base) => number[]) => cero().map((_, i) => bases.reduce((t, b) => t + (f(b)[i] || 0), 0));
  const lin = (f: (b: Base) => Record<Linea, number[]>) => Object.fromEntries(LINEAS.map(({ k }) => [k, s((b) => f(b)[k])])) as Record<Linea, number[]>;
  const out = {} as Base;
  for (const k of Object.keys(bases[0] ?? {}) as (keyof Base)[]) {
    if (k === "pvLinea" || k === "riLinea") (out as unknown as Record<string, unknown>)[k] = lin((b) => b[k] as Record<Linea, number[]>);
    else if (k !== "consolidado" && k !== "solv" && k !== "real") (out as unknown as Record<string, unknown>)[k] = s((b) => b[k] as number[]);
  }
  // solvencia del Consolidado: suma de las agencias (sin cuentas de orden si a alguna le faltan)
  if (bases.length && bases.every((b) => b.solv)) {
    const sv = bases.map((b) => b.solv!);
    const sumar = (os: Record<string, number>[]) => { const r: Record<string, number> = {}; for (const o of os) for (const [k, x] of Object.entries(o)) r[k] = (r[k] ?? 0) + x; return r; };
    out.solv = {
      corte: sumar(sv.map((x) => x.corte)), orden: sv.every((x) => x.orden) ? sumar(sv.map((x) => x.orden!)) : null,
      resultadoCorte: sv.reduce((t, x) => t + x.resultadoCorte, 0),
      inv: Object.fromEntries(Object.keys(sv[0].inv).map((k) => [k, cero().map((_, i) => sv.reduce((t, x) => t + x.inv[k][i], 0))])),
      n31: cero().map((_, i) => sv.reduce((t, x) => t + x.n31[i], 0)), n35: cero().map((_, i) => sv.reduce((t, x) => t + x.n35[i], 0)),
    };
  }
  out.consolidado = true;
  return out;
}

/**
 * Solvencia presupuestada: las cuentas proyectadas salen del presupuesto; las subcuentas que no se proyectan aparte y
 * los contingentes, del saldo del corte. Sin cuentas de orden del mes de corte no se calcula.
 */
function solvenciaPresupuesto(b: Base, m: number): { solvencia: number | null; patrimonioTecnico: number | null; ponderados: number | null } {
  const s = b.solv;
  if (b.real || !s || !s.orden) return { solvencia: null, patrimonioTecnico: null, ponderados: null };
  const k = s.corte;
  // resultados de años anteriores: los del corte más el resultado del año de corte (cierre)
  // en diciembre el resultado del año ya está en el patrimonio (3603 o 3604); de enero a noviembre va por el 5 − 4
  const delAnio = m === 11 ? b.i5[m] - b.e4[m] : 0;
  const pos = Math.abs(k["3601"] ?? 0) + Math.abs(k["3603"] ?? 0) + Math.max(0, s.resultadoCorte) + Math.max(0, delAnio);
  const neg = Math.abs(k["3602"] ?? 0) + Math.abs(k["3604"] ?? 0) + Math.max(0, -s.resultadoCorte) + Math.max(0, -delAnio);
  const bal: Record<string, number> = {
    "11": b.a11[m], "12": b.a12[m], "13": b.a13[m], "14": b.a14[m], "16": b.a16[m], "17": b.a17[m], "18": b.a18[m], "19": b.a19[m],
    "1908": b.a1908[m], "2908": b.p2908[m],
    ...Object.fromEntries(Object.entries(s.inv).map(([c, v]) => [c, v[m]])),
    "1403": b.pvLinea.inmobiliario[m] - (k["1411"] ?? 0) - (k["1419"] ?? 0), "1408": k["1408"] ?? 0,
    "1619": k["1619"] ?? 0, "199005": k["199005"] ?? 0,
    // 190286 (fondo de liquidez): lo que proyecta la 1902 menos sus demás subcuentas del corte
    "190286": b.a1902[m] - ((k["1902"] ?? 0) - (k["190286"] ?? 0)),
    "31": s.n31[m], "35": s.n35[m], "2801": k["2801"] ?? 0,
    "3201": k["3201"] ?? 0, "3202": k["3202"] ?? 0, "3301": k["3301"] ?? 0, "3303": k["3303"] ?? 0, "3304": k["3304"] ?? 0, "3305": k["3305"] ?? 0, "330115": k["330115"] ?? 0,
    "3601": pos, "3602": neg, "3603": 0, "3604": 0,
  };
  const r = solvencia(bal, { "5": b.i5[m], "4": b.e4[m] }, s.orden, m + 1);
  return { solvencia: r.solvencia, patrimonioTecnico: r.patrimonioTecnico, ponderados: r.ponderados };
}

const div = (a: number, b: number) => (Math.abs(b) > 1e-9 ? a / b : null);
const prom = (v: number[], m: number) => v.slice(0, m + 1).reduce((t, x) => t + x, 0) / (m + 1);
/** Promedio desde diciembre del año anterior (corte) hasta el mes m: (dic + ene..m) ÷ (m + 2). */
const promDic = (dic: number, v: number[], m: number) => (dic + v.slice(0, m + 1).reduce((t, x) => t + x, 0)) / (m + 2);

/** Valores e indicadores de una base en el mes m (0 = enero). Porcentajes en fracción (0,05 = 5 %). */
export function indicadores(b: Base, m: number) {
  const k = m + 1, anual = 12 / k;
  const ar = (i: number) => b.activo[i] - (b.consolidado ? 0 : b.a1908[i]);
  const activoReal = cero().map((_, i) => ar(i));
  const bruta = cero().map((_, i) => b.porVencer[i] + b.enRiesgo[i]);
  const utilidad = b.i5[m] - b.e4[m];
  const mtp = (b.i51[m] + b.i52[m]) - (b.e41[m] + b.e42[m]) - b.e44[m];
  const mfnAbs = (b.i51[m] - b.e41[m]) + (b.i52[m] + b.i54[m] - b.e42[m] + b.i53[m] - b.e43[m]) - b.e44[m];
  const dic = m === 11;
  const activoRealDic = b.c1[0] - (b.consolidado ? 0 : b.c1908[0]);
  const activoProm = promDic(activoRealDic, activoReal, m);
  // patrimonio como en el balance del sistema: sin el resultado del año hasta noviembre
  const patSistema = cero().map((_, i) => b.patrimonio[i] - (!b.real && i < 11 ? b.i5[i] - b.e4[i] : 0));
  const rendimiento = div(b.i5104[m] * anual, b.a14[m]);
  const costoFondos = div(b.e41[m] * anual, b.p21[m]);
  const ajuste19 = Math.min(Math.abs(b.a1908[m]), Math.abs(b.p2908[m]));
  const f1902 = b.a1902[m] - b.c1902NoProd[0];
  const productivos = b.a1103[m] + b.a12[m] + b.a13[m] + b.porVencer[m] + b.a1901[m] + f1902;
  const improductivos = (b.a11[m] - b.a1103[m]) + b.enRiesgo[m] + b.a1499[m] + b.a16[m] + b.a17[m] + b.a18[m] + (b.a19[m] - ajuste19) - b.a1901[m] - f1902;
  const linea = (l: Linea) => div(b.riLinea[l][m], b.pvLinea[l][m] + b.riLinea[l][m]);
  const crec = (v: number[]) => div(v[m] - v[0], v[0]);
  return {
    // tamaño y resultado
    activo: b.activo[m], activoReal: activoReal[m], cartera: bruta[m], carteraRiesgo: b.enRiesgo[m], captaciones: b.p21[m], patrimonio: b.patrimonio[m],
    gastosOperacion: b.e45[m],
    ingresos: b.i5[m], gastos: b.e4[m], utilidad,
    utilidadSinInternos: utilidad + b.e41059005[m] - b.i5190[m], interesInternoPagado: b.e41059005[m], interesInternoCobrado: b.i5190[m],
    // rentabilidad
    roa: dic ? div(utilidad, activoReal[11]) : div(utilidad * anual, activoProm),
    roe: dic ? div(utilidad, b.patrimonio[11]) : div(utilidad * anual, promDic(b.c3[0], patSistema, m)),
    margenUtilidad: div(utilidad, b.i5[m]),
    mni: div(b.i51[m] - b.e41[m], b.i51[m]),
    mfb: div((b.i51[m] - b.e41[m]) + b.i52[m] + b.i54[m] - b.e42[m] + b.i53[m] - b.e43[m], b.i51[m] + b.i52[m] + b.i53[m] + b.i54[m]),
    mfn: div(mtp, b.i51[m] + b.i52[m]),
    mop: div(mtp - b.e45[m] - b.e47[m], b.i51[m] + b.i52[m]),
    rendimiento, spread: rendimiento !== null && costoFondos !== null ? rendimiento - costoFondos : null,
    // calidad de activos y provisiones
    morosidad: div(b.enRiesgo[m], bruta[m]),
    morosidadLinea: Object.fromEntries(LINEAS.map(({ k: l }) => [l, linea(l)])) as Record<Linea, number | null>,
    cobertura: div(Math.abs(b.a1499[m]), b.enRiesgo[m]),
    provisionAnio: b.e44[m], costoRiesgo: div(b.e44[m] * anual, prom(bruta, m)),
    activosProductivos: div(productivos, activoReal[m]), activosImproductivos: div(improductivos, activoReal[m]),
    // eficiencia
    absorcion: div(b.e45[m], mfnAbs),
    goActivo: div(b.e45[m] * anual, activoProm), goCartera: div(b.e45[m] * anual, prom(b.a14, m)),
    gpActivo: div(b.e4501[m] * anual, activoProm), gpCartera: div(b.e4501[m] * anual, prom(b.a14, m)),
    goIngresos: div(b.e45[m], b.i5[m]), gpIngresos: div(b.e4501[m], b.i5[m]),
    // liquidez y crecimiento
    fondosActivo: div(Math.abs(b.a11[m]), Math.abs(activoReal[m])), fondosDepositos: div(Math.abs(b.a11[m]), Math.abs(b.p21[m] - b.c21NoDep[0])),
    fondeo: div(b.p21[m], b.a14[m]),
    crecCartera: crec(bruta), crecCaptaciones: crec(b.p21), crecActivo: crec(b.activo), crecPatrimonio: crec(b.patrimonio),
    // con cuentas contingentes y de orden (solo con cifras reales: el presupuesto no proyecta esas cuentas)
    ...solvenciaPresupuesto(b, m),
    coberturaLinea: Object.fromEntries(LINEAS.map(({ k: l }) => [l, null])) as Record<Linea, number | null>,
  };
}
export type Indicadores = ReturnType<typeof indicadores>;

/** Estado de resultados resumido (acumulado al mes), en el orden de la cascada de márgenes. */
export function resultados(b: Base, m: number) {
  const mni = b.i51[m] - b.e41[m];
  const mfb = mni + b.i52[m] + b.i54[m] - b.e42[m] + b.i53[m] - b.e43[m];
  const mfn = mfb - b.e44[m];
  const mop = mfn - b.e45[m];
  return [
    { id: "i51", label: "Intereses ganados", codigo: "51", v: b.i51[m] },
    { id: "e41", label: "Intereses pagados", codigo: "41", v: -b.e41[m] },
    { id: "mni", label: "Margen neto de intereses", v: mni, total: true },
    { id: "com", label: "Comisiones y servicios", codigo: "52 + 53 + 54", v: b.i52[m] + b.i53[m] + b.i54[m] },
    { id: "ecom", label: "Comisiones y pérdidas", codigo: "42 + 43", v: -(b.e42[m] + b.e43[m]) },
    { id: "mfb", label: "Margen financiero bruto", v: mfb, total: true },
    { id: "e44", label: "Provisiones", codigo: "44", v: -b.e44[m] },
    { id: "mfn", label: "Margen financiero neto", v: mfn, total: true },
    { id: "e45", label: "Gastos de operación", codigo: "45", v: -b.e45[m] },
    { id: "mop", label: "Margen operacional", v: mop, total: true },
    { id: "otros", label: "Otros ingresos", codigo: "55 + 56", v: b.i55[m] + b.i56[m] },
    { id: "e47", label: "Otros gastos e impuestos", codigo: "47 + 48", v: -(b.e47[m] + b.e48[m]) },
    { id: "util", label: "Utilidad del ejercicio", v: b.i5[m] - b.e4[m], total: true, fuerte: true },
  ];
}

/** Gastos de operación por subgrupo (acumulado al mes). */
export const SUBGRUPOS_45: { k: keyof Base; codigo: string; n: string }[] = [
  { k: "e4501", codigo: "4501", n: "Gastos de personal" }, { k: "e4502", codigo: "4502", n: "Honorarios" },
  { k: "e4503", codigo: "4503", n: "Servicios varios" }, { k: "e4504", codigo: "4504", n: "Impuestos y aportes" },
  { k: "e4505", codigo: "4505", n: "Depreciaciones" }, { k: "e4506", codigo: "4506", n: "Amortizaciones" },
  { k: "e4507", codigo: "4507", n: "Otros gastos" },
];
