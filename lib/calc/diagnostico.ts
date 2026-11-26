/**
 * Diagnóstico por agencia con los históricos (balance mensual y estado de resultados acumulado del año).
 * Para un mes P del año Y: los flujos del ER se anualizan (× 12 / mes) y se dividen para el saldo promedio
 * de dic(Y−1) … P del balance. Todo es puro: recibe el mapa "oficina|periodo|tipo" → cuentas.
 */
const OFICINAS_HIST = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"] as const;

export interface Indicadores {
  cartera: number; morosidad: number; captaciones: number; autofinanciamiento: number;
  recibe: number; envia: number; activo: number;
  rendimiento: number; costoCaptaciones: number; tasaInterna: number | null;
  eficiencia: number | null; costoRiesgo: number; roa: number;
  utilidad: number; utilidadSinInternos: number; interesInternoPagado: number; interesInternoCobrado: number;
  crecimientoCartera: number | null; crecimientoCaptaciones: number | null;
}

type Cuentas = Record<string, number>;
const v = (c: Cuentas | undefined, k: string) => c?.[k] ?? 0;
const carteraBruta = (b?: Cuentas) => (b ? Object.entries(b).reduce((t, [k, x]) => (k.length === 4 && k.startsWith("14") && k !== "1499" ? t + x : t), 0) : 0);
const carteraEnMora = (b?: Cuentas) => (b ? Object.entries(b).reduce((t, [k, x]) => (k.length === 4 && k.startsWith("14") && k !== "1499" && Number(k.slice(2)) >= 25 ? t + x : t), 0) : 0);

export function indicadoresMes(datos: Map<string, Cuentas>, oficina: string, periodo: string): Indicadores | null {
  const [y, m] = periodo.split("-").map(Number);
  const b = datos.get(`${oficina}|${periodo}|BAL`); const e = datos.get(`${oficina}|${periodo}|ER`);
  if (!b || !e) return null;
  const meses = [`${y - 1}-12`, ...Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`)];
  const bals = meses.map((p) => datos.get(`${oficina}|${p}|BAL`)).filter((x): x is Cuentas => !!x);
  const prom = (f: (c: Cuentas) => number) => bals.reduce((t, c) => t + f(c), 0) / bals.length;
  const an = 12 / m;
  const div = (a: number, d: number) => (d ? a / d : 0);
  const cartera = carteraBruta(b);
  const ut = v(e, "5") - v(e, "4");
  const pag = v(e, "41059005"), cob = v(e, "51909005");
  const margen = v(e, "51") + v(e, "52") + v(e, "53") + v(e, "54") - v(e, "41") - v(e, "42") - v(e, "43");
  const recProm = prom((c) => v(c, "2908"));
  const dicAnt = datos.get(`${oficina}|${y - 1}-12|BAL`);
  return {
    cartera, morosidad: div(carteraEnMora(b), cartera), captaciones: v(b, "21"), autofinanciamiento: div(v(b, "21"), cartera),
    recibe: v(b, "2908"), envia: v(b, "1908"), activo: v(b, "1") - v(b, "1908"),
    rendimiento: div(v(e, "5104") * an, prom(carteraBruta)),
    costoCaptaciones: div(v(e, "4101") * an, prom((c) => v(c, "21"))),
    tasaInterna: recProm > 1000 ? (pag * an) / recProm : null,
    eficiencia: margen > 0 ? v(e, "45") / margen : null,
    costoRiesgo: div(v(e, "44") * an, prom(carteraBruta)),
    roa: div(ut * an, prom((c) => v(c, "1") - v(c, "1908"))),
    utilidad: ut, utilidadSinInternos: ut + pag - cob, interesInternoPagado: pag, interesInternoCobrado: cob,
    crecimientoCartera: dicAnt && carteraBruta(dicAnt) ? cartera / carteraBruta(dicAnt) - 1 : null,
    crecimientoCaptaciones: dicAnt && v(dicAnt, "21") ? v(b, "21") / v(dicAnt, "21") - 1 : null,
  };
}

export interface Diagnostico { periodos: string[]; oficinas: string[]; series: Record<string, Record<string, Indicadores>> }

/** Arma el diagnóstico desde el resumen guardado (indicadores ya calculados por oficina y mes). */
export function diagnosticoDesdeResumen(series: Record<string, Record<string, Indicadores>>): Diagnostico {
  const oficinas = OFICINAS_HIST.filter((o) => series[o] && Object.keys(series[o]).length);
  const periodos = [...new Set(oficinas.flatMap((o) => Object.keys(series[o])))].sort();
  return { periodos, oficinas: [...oficinas], series };
}
