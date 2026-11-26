/**
 * SOLVENCIA (patrimonio técnico ÷ activos y contingentes ponderados por riesgo) y COBERTURA POR LÍNEA, con las
 * fórmulas de la herramienta de indicadores. Necesitan las cuentas contingentes y de orden (6 y 7), que se suben en
 * Carga de datos → Históricos.
 */
import type { Linea } from "./indicadores-presupuesto";

type Saldos = Record<string, number>;
const v = (m: Saldos | undefined, c: string) => Number(m?.[c]) || 0;
const a = (m: Saldos | undefined, c: string) => Math.abs(v(m, c));

/** Filas de activos y contingentes ponderados por riesgo (ponderación y forma de agregación). */
const APR: { codigo: string; factor: number; resta?: boolean }[] = [
  { codigo: "11", factor: 0 }, { codigo: "1302", factor: 0 }, { codigo: "1304", factor: 0 }, { codigo: "1306", factor: 0 },
  { codigo: "199005", factor: 0 }, { codigo: "190286", factor: 0 }, { codigo: "6404", factor: 0 }, { codigo: "640410", factor: 0, resta: true }, { codigo: "7108", factor: 0 },
  { codigo: "12", factor: 0.2 }, { codigo: "1307", factor: 0.2 },
  { codigo: "1301", factor: 0.5 }, { codigo: "1303", factor: 0.5 }, { codigo: "1305", factor: 0.5 }, { codigo: "1403", factor: 0.5 }, { codigo: "1408", factor: 0.5 },
  { codigo: "1619", factor: 0.5 }, { codigo: "640505", factor: 0.5 },
  { codigo: "13", factor: 1 }, { codigo: "14", factor: 1 }, { codigo: "16", factor: 1 }, { codigo: "17", factor: 1 }, { codigo: "18", factor: 1 }, { codigo: "19", factor: 1 }, { codigo: "64", factor: 1 },
];

export interface ResultadoSolvencia { solvencia: number | null; patrimonioTecnico: number; ponderados: number }

/** mes: 1..12. bal y er del mes (resultados acumulados), co: cuentas contingentes y de orden del mes. */
export function solvencia(bal: Saldos, er: Saldos | undefined, co: Saldos, mes: number): ResultadoSolvencia {
  const eneNov = mes >= 1 && mes <= 11;
  const resultado = v(er, "5") - v(er, "4");
  const primario = a(bal, "31") + a(bal, "3201") + a(bal, "3301") + a(bal, "3304") - a(bal, "330115") + a(bal, "3303")
    - a(bal, "3602") - a(bal, "3604") + (eneNov && resultado < 0 ? resultado : 0);
  const secundario = a(bal, "2801") + a(bal, "3202") + 0.5 * a(bal, "3305") + 0.45 * a(bal, "35") + a(bal, "3601") + a(bal, "3603")
    + (eneNov && resultado > 0 ? 0.5 * resultado : 0) + a(bal, "330115");
  const patrimonioTecnico = primario + secundario;

  const saldo = (c: string) => (c.startsWith("6") || c.startsWith("7") ? a(co, c) : a(bal, c));
  const crudo = APR.map((r) => ({ ...r, saldo: saldo(r.codigo) }));
  const otros = (pref: string, extra: string[] = []) => crudo.filter((o) => (o.codigo !== pref && o.codigo.startsWith(pref)) || extra.includes(o.codigo)).reduce((t, o) => t + o.saldo, 0);
  const ponderados = crudo.reduce((t, r) => {
    let s = r.saldo;
    if (r.factor === 1) {
      if (r.codigo === "13" || r.codigo === "16" || r.codigo === "64") s = Math.max(0, s - otros(r.codigo));
      else if (r.codigo === "14") s = Math.max(0, s - otros("14", ["7108"]));
      else if (r.codigo === "19") s = Math.max(0, s - Math.min(a(bal, "1908"), a(bal, "2908")) - otros("19"));
    }
    const w = s * r.factor;
    return t + (r.resta ? -w : w);
  }, 0);
  return { solvencia: ponderados ? patrimonioTecnico / ponderados : null, patrimonioTecnico, ponderados };
}

/** Cobertura de la cartera improductiva de cada línea: provisión (1499xx + cuentas de orden 7414xx) ÷ improductiva. */
const COBERTURA: Record<Linea, { prov: string; orden: string[]; ri: string[] }> = {
  consumo: { prov: "149910", orden: ["741402", "741410", "741417", "741421"], ri: ["1426", "1434", "1442", "1450", "1458", "1466"] },
  microcredito: { prov: "149920", orden: ["741404", "741412", "741418", "741423"], ri: ["1428", "1436", "1444", "1452", "1460", "1468"] },
  inmobiliario: { prov: "149915", orden: ["741403", "741411", "741422", "741416"], ri: ["1427", "1435", "1443", "1451", "1459", "1467", "1432", "1440", "1448", "1456", "1464", "1472"] },
  productivo: { prov: "149905", orden: ["741401", "741409", "741415"], ri: ["1425", "1433", "1441", "1449", "1457", "1465"] },
};
export function coberturaPorLinea(bal: Saldos, co: Saldos): Record<Linea, number | null> {
  return Object.fromEntries((Object.keys(COBERTURA) as Linea[]).map((l) => {
    const c = COBERTURA[l];
    const improductiva = c.ri.reduce((t, k) => t + v(bal, k), 0);
    const provision = a(bal, c.prov) + c.orden.reduce((t, k) => t + a(co, k), 0);
    return [l, improductiva ? provision / improductiva : null];
  })) as Record<Linea, number | null>;
}
