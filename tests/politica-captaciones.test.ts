/**
 * Política de captaciones: los parámetros que genera hacen crecer el saldo exactamente el % anual fijado
 * con el mismo motor del presupuesto, y la tasa de DPF sube de forma gradual.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarPolitica, vencimientoDelBalance, tasaDPFMes, validarPolitica, POLITICA_DEFECTO } from "../lib/calc/politica-captaciones";
import { calcularCaptaciones } from "../lib/calc/captaciones";
import type { FilaParametroCaptaciones } from "../lib/calc/orquestador";

const filas: FilaParametroCaptaciones[] = (["VISTA", "CRECER", "DPF"] as const).flatMap((producto) => Array.from({ length: 12 }, (_, i) => ({
  producto, mes: i + 1, tasa_interes_anual: producto === "VISTA" ? 0.008 : producto === "CRECER" ? 0.02 : 0.077,
  pct_ingresos: producto === "DPF" ? null : 0.03, pct_retiros: producto === "DPF" ? null : 0.028,
  pct_cancelaciones: producto === "DPF" ? 0.07 : null, ratio_renovaciones: producto === "DPF" ? 1.02 : null, pct_liquidez: 0.001,
})));
const a12 = (fs: FilaParametroCaptaciones[], p: string, k: keyof FilaParametroCaptaciones) => fs.filter((f) => f.producto === p).sort((a, b) => a.mes - b.mes).map((f) => Number(f[k]) || 0);

test("la política hace crecer cada producto el % anual fijado", () => {
  const p = { ...POLITICA_DEFECTO, crecDPF: 0.02, crecVista: 0.03, crecCrecer: -0.01 };
  const n = aplicarPolitica(filas, p, vencimientoDelBalance(8_728_082, 86_591_171));
  const r = calcularCaptaciones({
    saldoInicialVista: 1_000_000, paramsVista: { tasaInteresAnual: a12(n, "VISTA", "tasa_interes_anual"), pctIngresosPeriodo: a12(n, "VISTA", "pct_ingresos"), pctRetirosPeriodo: a12(n, "VISTA", "pct_retiros") },
    saldoInicialCrecer: 500_000, paramsCrecer: { tasaInteresAnual: a12(n, "CRECER", "tasa_interes_anual"), pctIngresosPeriodo: a12(n, "CRECER", "pct_ingresos"), pctRetirosPeriodo: a12(n, "CRECER", "pct_retiros") },
    saldoInicialDPF: 2_000_000, paramsDPF: { pctCancelaciones: a12(n, "DPF", "pct_cancelaciones"), ratioRenovaciones: a12(n, "DPF", "ratio_renovaciones") },
  });
  assert.ok(Math.abs(r.dpf[11].saldoFinal / 2_000_000 - 1.02) < 1e-9);
  assert.ok(Math.abs(r.vista[11].saldoFinal / 1_000_000 - 1.03) < 1e-9);
  assert.ok(Math.abs(r.crecer[11].saldoFinal / 500_000 - 0.99) < 1e-9);
  // los retiros reales se conservan; la liquidez no se toca
  assert.equal(n.find((f) => f.producto === "VISTA")!.pct_retiros, 0.028);
  assert.equal(n.find((f) => f.producto === "DPF")!.pct_liquidez, 0.001);
});

test("tasa de DPF gradual de 6,50 % a 7,00 % y vencimiento del balance", () => {
  assert.equal(tasaDPFMes(POLITICA_DEFECTO, 1), 0.065);
  assert.ok(Math.abs(tasaDPFMes(POLITICA_DEFECTO, 12) - 0.07) < 1e-12);
  assert.ok(Math.abs(vencimientoDelBalance(8_728_082, 86_591_171) - 0.1008) < 1e-3);
  assert.equal(vencimientoDelBalance(0, 1000), 0.10);
  assert.equal(validarPolitica(POLITICA_DEFECTO), null);
  assert.notEqual(validarPolitica({ ...POLITICA_DEFECTO, tasaDPFFin: 0.5 }), null);
});
