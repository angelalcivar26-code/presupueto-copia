import type { FilaParametroCaptaciones } from "./orquestador";

/**
 * POLÍTICA DE CAPTACIONES (Obligaciones con el público → Política)
 *
 * Una sola regla para las 10 agencias, guardada por ejercicio, que se convierte en los parámetros mensuales de
 * cada agencia (los mismos que se editan a mano en cada producto):
 *   · DPF: cada mes vence una parte del saldo (por defecto, lo que el balance del corte tiene a 1–30 días, 210305 ÷ 2103);
 *     de lo que vence se renueva (con dinero nuevo) lo necesario para crecer el % anual fijado:
 *        renovación = 1 + ((1 + crecimiento)^(1/12) − 1) ÷ vencimiento mensual
 *     la tasa sube de forma gradual de enero a diciembre (tasa del mes = inicial + (final − inicial) × (mes − 1) ÷ 11).
 *   · Ahorro a la vista y Crecer: se conservan los retiros reales de la agencia y los depósitos se fijan para crecer el % anual:
 *        depósitos = (1 + crecimiento mensual) ÷ (1 + tasa ÷ 12) − 1 + retiros
 *     (fórmula del motor: saldo final = saldo × (1 + depósitos − retiros) × (1 + tasa ÷ 12)).
 */
export interface PoliticaCaptaciones {
  /** Crecimiento anual del saldo (0,02 = 2 %). */
  crecDPF: number; crecVista: number; crecCrecer: number;
  /** Tasa anual de DPF en enero y en diciembre (sube de forma gradual). */
  tasaDPFIni: number; tasaDPFFin: number;
  /** Tasa anual de ahorro a la vista y de Crecer; null = se mantiene la de cada agencia. */
  tasaVista: number | null; tasaCrecer: number | null;
  /** Parte del saldo de DPF que vence cada mes; null = la de cada agencia según su balance (1–30 días). */
  vencDPF: number | null;
}

export const POLITICA_DEFECTO: PoliticaCaptaciones = {
  crecDPF: 0.02, crecVista: 0.02, crecCrecer: 0.02, tasaDPFIni: 0.065, tasaDPFFin: 0.07, tasaVista: null, tasaCrecer: null, vencDPF: null,
};
/** Sin datos del balance (o un valor fuera de lo razonable): 10 % al mes, lo que vence la cooperativa a 1–30 días. */
export const VENC_DEFECTO = 0.10;
const VENC_MIN = 0.03, VENC_MAX = 0.30;

/** Parte del DPF que vence en el mes según el balance del corte: 1–30 días (210305) ÷ total de DPF (2103). */
export function vencimientoDelBalance(a30: number, dpf: number): number {
  const v = dpf > 0 ? a30 / dpf : 0;
  return v >= VENC_MIN && v <= VENC_MAX ? v : VENC_DEFECTO;
}

export const tasaDPFMes = (p: PoliticaCaptaciones, mes: number) => p.tasaDPFIni + (p.tasaDPFFin - p.tasaDPFIni) * (mes - 1) / 11;
const mensual = (anual: number) => (1 + anual) ** (1 / 12) - 1;

/** Revisa la política: devuelve el primer error o null. */
export function validarPolitica(p: PoliticaCaptaciones): string | null {
  const en = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (![p.crecDPF, p.crecVista, p.crecCrecer].every((v) => en(v, -0.3, 0.3))) return "El crecimiento anual debe estar entre −30 % y 30 %.";
  if (!en(p.tasaDPFIni, 0, 0.2) || !en(p.tasaDPFFin, 0, 0.2)) return "La tasa de DPF debe estar entre 0 % y 20 %.";
  if (p.tasaVista !== null && !en(p.tasaVista, 0, 0.2)) return "La tasa de ahorro a la vista debe estar entre 0 % y 20 %.";
  if (p.tasaCrecer !== null && !en(p.tasaCrecer, 0, 0.2)) return "La tasa de Crecer debe estar entre 0 % y 20 %.";
  if (p.vencDPF !== null && !en(p.vencDPF, VENC_MIN, VENC_MAX)) return `Lo que vence de DPF al mes debe estar entre ${VENC_MIN * 100} % y ${VENC_MAX * 100} %.`;
  return null;
}

/** Parámetros mensuales de una agencia con la política (los meses sin fila parten de cero). */
export function aplicarPolitica(filas: FilaParametroCaptaciones[], p: PoliticaCaptaciones, vencAgencia: number): FilaParametroCaptaciones[] {
  const out: FilaParametroCaptaciones[] = [];
  const venc = p.vencDPF ?? vencAgencia;
  for (const producto of ["VISTA", "CRECER", "DPF"] as const) {
    for (let mes = 1; mes <= 12; mes++) {
      const f = filas.find((x) => x.producto === producto && x.mes === mes);
      const base: FilaParametroCaptaciones = {
        producto, mes, tasa_interes_anual: Number(f?.tasa_interes_anual) || 0,
        pct_ingresos: f?.pct_ingresos ?? null, pct_retiros: f?.pct_retiros ?? null,
        pct_cancelaciones: f?.pct_cancelaciones ?? null, ratio_renovaciones: f?.ratio_renovaciones ?? null,
        pct_liquidez: f?.pct_liquidez ?? 0,
      };
      if (producto === "DPF") {
        out.push({ ...base, tasa_interes_anual: tasaDPFMes(p, mes), pct_cancelaciones: venc, ratio_renovaciones: 1 + mensual(p.crecDPF) / venc, pct_ingresos: null, pct_retiros: null });
      } else {
        const tasa = (producto === "VISTA" ? p.tasaVista : p.tasaCrecer) ?? base.tasa_interes_anual;
        let ret = Number(base.pct_retiros) || 0;
        let ing = (1 + mensual(producto === "VISTA" ? p.crecVista : p.crecCrecer)) / (1 + tasa / 12) - 1 + ret;
        if (ing < 0) { ret -= ing; ing = 0; }
        out.push({ ...base, tasa_interes_anual: tasa, pct_ingresos: ing, pct_retiros: ret, pct_cancelaciones: null, ratio_renovaciones: null });
      }
    }
  }
  return out;
}
