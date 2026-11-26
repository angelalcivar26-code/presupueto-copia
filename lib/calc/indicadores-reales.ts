/**
 * INDICADORES REALES: los mismos indicadores del presupuesto calculados con los saldos reales (Históricos), con las
 * cuentas de la herramienta de indicadores. Se arma una Base con cifras reales y se usa indicadores().
 */
import { indicadores, type Base, type Indicadores, type Linea } from "./indicadores-presupuesto";
import { coberturaPorLinea, solvencia } from "./solvencia";

type Saldos = Record<string, number>; // código → valor de un mes

// Cartera (herramienta de indicadores): por vencer, que no devenga y vencida
const POR_VENCER = ["1401", "1402", "1403", "1404", "1408", "1409", "1410", "1411", "1412", "1416", "1417", "1418", "1419", "1420", "1424", "1473", "1475", "1477"];
const NO_DEVENGA = ["1425", "1426", "1427", "1428", "1432", "1433", "1434", "1435", "1436", "1440", "1441", "1442", "1443", "1444", "1448", "1479", "1481", "1483"];
const VENCIDA = ["1449", "1450", "1451", "1452", "1456", "1457", "1458", "1459", "1460", "1464", "1465", "1466", "1467", "1468", "1472", "1485", "1487", "1489"];
const LINEA: Record<Linea, { pv: string[]; ri: string[] }> = {
  consumo: { pv: ["1402", "1410", "1418"], ri: ["1426", "1434", "1442", "1450", "1458", "1466"] },
  microcredito: { pv: ["1404", "1412", "1420"], ri: ["1428", "1436", "1444", "1452", "1460", "1468"] },
  inmobiliario: { pv: ["1403", "1411", "1419", "1408", "1416", "1424"], ri: ["1427", "1435", "1443", "1451", "1459", "1467", "1432", "1440", "1448", "1456", "1464", "1472"] },
  productivo: { pv: ["1401", "1409", "1417"], ri: ["1425", "1433", "1441", "1449", "1457", "1465"] },
};
const PROD_1902 = ["190205", "190210", "190215", "190220", "190280", "190286"];

/**
 * Indicadores reales de los 12 meses (null en los meses sin balance o estado de resultados cargado, o cuando falta
 * un mes anterior que el promedio necesita). dic: balance de diciembre del año anterior.
 */
export function indicadoresReales(bal: (Saldos | undefined)[], er: (Saldos | undefined)[], dic: Saldos | undefined, consolidado: boolean, co: (Saldos | undefined)[] = []): (Indicadores | null)[] {
  const v = (m: Saldos | undefined, c: string) => Number(m?.[c]) || 0;
  const sum = (m: Saldos | undefined, cs: string[]) => cs.reduce((t, c) => t + v(m, c), 0);
  const arr = (f: (b: Saldos | undefined, e: Saldos | undefined) => number) => bal.map((b, i) => f(b, er[i]));
  const B = (c: string) => arr((b) => v(b, c));
  const E = (c: string) => arr((_b, e) => v(e, c));
  const porLinea = (k: "pv" | "ri") => Object.fromEntries((Object.keys(LINEA) as Linea[]).map((l) => [l, arr((b) => sum(b, LINEA[l][k]))])) as Record<Linea, number[]>;
  const base: Base = {
    activo: B("1"), a1908: B("1908"), a11: B("11"), a1103: B("1103"), a12: B("12"), a13: B("13"), a14: B("14"),
    porVencer: arr((b) => sum(b, POR_VENCER)), enRiesgo: arr((b) => sum(b, NO_DEVENGA) + sum(b, VENCIDA)),
    pvLinea: porLinea("pv"), riLinea: porLinea("ri"),
    a1499: B("1499"), a16: B("16"), a17: B("17"), a18: B("18"), a19: B("19"), a1901: B("1901"),
    a1902: arr((b) => sum(b, PROD_1902)), // solo la parte productiva (la no productiva queda en 0)
    p21: B("21"), depositos: arr((b) => v(b, "2101") + v(b, "2103")), dpf: B("2103"), p29: B("29"), p2908: B("2908"), patrimonio: B("3"),
    i5: E("5"), i51: E("51"), i5104: E("5104"), i5190: E("5190"), i52: E("52"), i53: E("53"), i54: E("54"), i55: E("55"), i56: E("56"),
    e4: E("4"), e41: E("41"), e41059005: E("41059005"), e42: E("42"), e43: E("43"), e44: E("44"), e45: E("45"),
    e4501: E("4501"), e4502: E("4502"), e4503: E("4503"), e4504: E("4504"), e4505: E("4505"), e4506: E("4506"), e4507: E("4507"),
    e47: E("47"), e48: E("48"),
    c1: [v(dic, "1")], c1908: [v(dic, "1908")], c3: [v(dic, "3")], c1902NoProd: [0], c21NoDep: [0],
    consolidado, real: true,
  };
  return bal.map((b, m) => {
    // el mes y los anteriores deben estar cargados (los promedios van desde diciembre)
    if (!dic) return null;
    for (let k = 0; k <= m; k++) if (!bal[k] || !er[k]) return null;
    const x = indicadores(base, m);
    // fondos disponibles ÷ (2101 + 2103) con los saldos reales del mes
    const out = { ...x, fondosDepositos: base.depositos[m] ? Math.abs(base.a11[m]) / Math.abs(base.depositos[m]) : null };
    // solvencia y cobertura por línea: solo si se cargaron las cuentas contingentes y de orden del mes
    const orden = co[m];
    if (orden && b) {
      const s = solvencia(b, er[m], orden, m + 1);
      Object.assign(out, { solvencia: s.solvencia, patrimonioTecnico: s.patrimonioTecnico, ponderados: s.ponderados, coberturaLinea: coberturaPorLinea(b, orden) });
    }
    return out;
  });
}
