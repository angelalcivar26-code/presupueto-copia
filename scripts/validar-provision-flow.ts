import { SEMILLA_CALIFICACION, SEMILLA_PARAMETROS, SEMILLA_EERR } from "../lib/provision-semilla";
import { proyectarProvisionFlow, castigoPorProducto, productoDe, tramoDe, PRODUCTOS, ESCENARIOS, recalibrar, backtest, type ParametrosFlow, type SaldosTramo, type HistoriaTramos } from "../lib/calc/provision-flow";
const par = {} as ParametrosFlow;
for (const [p, t, n, o, b, pe, tasa] of SEMILLA_PARAMETROS) { (par[p as never] ??= {} as never); (par as any)[p][t] = { n, fr: { optimista: o, base: b, pesimista: pe }, tasa }; }
const vacio = (): SaldosTramo => Object.fromEntries(PRODUCTOS.map((p) => [p, {}])) as SaldosTramo;
const hist: HistoriaTramos = { saldo: {}, prov: {} };
const porAg: Record<string, SaldosTramo> = {};
for (const [periodo, , of, tipo, cat, , , saldo, , prov] of SEMILLA_CALIFICACION) {
  const p = productoDe(tipo)!; const t = tramoDe(p, cat)!;
  const s = (hist.saldo[periodo] ??= vacio()); s[p][t] = (s[p][t] ?? 0) + saldo;
  const v = (hist.prov[periodo] ??= vacio()); v[p][t] = (v[p][t] ?? 0) + prov;
  if (periodo === "2026-09") { const a = (porAg[of] ??= vacio()); a[p][t] = (a[p][t] ?? 0) + saldo; }
}
const cons = hist.saldo["2026-09"];
for (const e of ESCENARIOS) {
  const r = proyectarProvisionFlow({ parametros: par, escenario: e, inicial: cons, castigoMensualPorProducto: castigoPorProducto(300000, cons, cons), mesesPuente: 3, totalesEjercicio: null, restarCastigos: false });
  const g = PRODUCTOS.reduce((a, p) => a + r[p].gastoNeto.reduce((x, y) => x + y, 0), 0);
  const pv = PRODUCTOS.reduce((a, p) => a + r[p].provision[11], 0);
  // suma por agencia
  let ga = 0;
  for (const [, ini] of Object.entries(porAg)) {
    const ra = proyectarProvisionFlow({ parametros: par, escenario: e, inicial: ini, castigoMensualPorProducto: castigoPorProducto(300000, ini, cons), mesesPuente: 3, totalesEjercicio: null, restarCastigos: false });
    ga += PRODUCTOS.reduce((a, p) => a + ra[p].gastoNeto.reduce((x, y) => x + y, 0), 0);
  }
  console.log(e, Math.round(g), Math.round(pv), "suma agencias:", Math.round(ga));
}
const eerr = SEMILLA_EERR.map(([periodo, g4402, r560410, r560405]) => ({ periodo, g4402, r560410, r560405 }));
const cal = recalibrar({ historia: hist, eerr, ventanaDesde: "2026-06", ventanaHasta: "2026-09", factorOptimista: 0.8, factorPesimista: 1.25, parametrosActuales: par });
let maxd = 0;
for (const p of PRODUCTOS) for (const k of Object.keys(par[p])) for (const e of ESCENARIOS) maxd = Math.max(maxd, Math.abs(cal.parametros[p][k].fr[e] - par[p][k].fr[e]), Math.abs(cal.parametros[p][k].tasa - par[p][k].tasa));
console.log("recalibración: dif máx vs Excel", maxd, "FR_E", cal.frEBruto, cal.ventanaE, "castigo sugerido", Math.round(cal.castigoMensualSugerido ?? 0));
const bt = backtest({ historia: hist, eerr, parametros: par, escenario: "base", desde: "2026-04", hasta: "2026-08" });
console.log("backtest", Math.round(bt.modelo), Math.round(bt.real), (bt.modelo / bt.real).toFixed(3));
