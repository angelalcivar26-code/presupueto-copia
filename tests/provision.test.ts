/**
 * Pruebas automáticas de la provisión y de las metas de cartera. Se corren antes de publicar cada cambio:
 *   npm test
 * Cada prueba cubre un error que ya pasó o que no debe pasar: si falla, el cambio no se publica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proyectarProvisionFlow, calibrarRitmoAgencia, recalibrar, parametrosAgencia, PRODUCTOS, TRAMOS,
  type ParametrosFlow, type SaldosTramo, type Producto, type CorteAgencia,
} from "../lib/calc/provision-flow";
import { metaPropuesta, resultadoDelAnio, elegirIdoneo, faltaParaMeta } from "../lib/calc/provision-metas";
import { controlesProvision, type FlowAgencia } from "../lib/control-provision";
import { eerrDeHistoricos } from "../lib/provision-flow-db";

// ---------- datos de prueba ----------
const fr = (x: number) => ({ optimista: x * 0.8, base: x, pesimista: x * 1.25 });
const TASAS: Record<string, number> = { V: 0.014, M1: 0.04, M2: 0.14, M3: 0.45, M4: 1, E: 1, A2: 0.02, A3: 0.04, B1: 0.08, B2: 0.15, C1: 0.3, C2: 0.5, D: 0.8 };
function parametros(): ParametrosFlow {
  const out = {} as ParametrosFlow;
  for (const p of PRODUCTOS) {
    out[p] = {};
    TRAMOS[p].forEach((k, i) => { out[p][k] = { n: 1, fr: i === 0 ? fr(0) : fr(i === TRAMOS[p].length - 1 ? 0.55 : 0.2), tasa: TASAS[k] ?? 0.1 }; });
  }
  return out;
}
function saldos(escala: number): SaldosTramo {
  const out = {} as SaldosTramo;
  for (const p of PRODUCTOS) { out[p] = {}; TRAMOS[p].forEach((k, i) => { out[p][k] = (i === 0 ? 1_000_000 : 50_000 / (i + 1)) * escala; }); }
  return out;
}
const castigo = Object.fromEntries(PRODUCTOS.map((p) => [p, 5_000])) as Record<Producto, number>;

// ---------- 1. El modelo cuadra: provisión final = inicial + gasto neto − castigos ----------
test("la provisión de cada producto cuadra mes a mes (inicial + gasto − castigos = final)", () => {
  const r = proyectarProvisionFlow({ parametros: parametros(), escenario: "base", inicial: saldos(1), castigoMensualPorProducto: castigo,
    mesesPuente: 2, totalesEjercicio: null, restarCastigos: true });
  for (const p of PRODUCTOS) {
    const x = r[p];
    let prev = x.provisionInicio;
    for (let i = 0; i < 12; i++) {
      assert.ok(Math.abs(prev + x.gastoNeto[i] - x.castigos[i] - x.provision[i]) < 0.01, `${p} mes ${i + 1}`);
      assert.ok(Math.abs(x.gasto4402[i] - x.reversion[i] - x.gastoNeto[i]) < 0.01, `${p} 4402 − 5604.10 = neto, mes ${i + 1}`);
      prev = x.provision[i];
    }
  }
});

// ---------- 2. El estado de resultados viene acumulado: el resultado del año es diciembre, no la suma ----------
test("el resultado del año es el de diciembre (no la suma de los meses acumulados)", () => {
  const acumulado = [-47240, -111212, -137883, -182345, -226538, -266771, -306624, -345790, -388638, -427235, -465596, -503739];
  assert.equal(resultadoDelAnio(acumulado), -503739);
  assert.equal(resultadoDelAnio([]), 0);
});

// ---------- 3. Sin mejoras, los supuestos iguales a lo real no cambian el modelo ----------
test("con los supuestos de cartera iguales a lo real, la provisión queda igual (base sin mejoras)", () => {
  const base = parametros();
  const ref = { pase: { CONSUMO: 0.012, MICROCREDITO: 0.03 }, rv: 0.04, desde: "2026-06", hasta: "2026-10" };
  const igual = parametrosAgencia(base, 1, { pase: { CONSUMO: 0.012, MICROCREDITO: 0.03 }, rv: { CONSUMO: 0.04, MICROCREDITO: 0.04 } }, ref);
  assert.deepEqual(igual, base);
  // con menos pase a riesgo, solo baja la primera entrada a la mora, en la misma proporción
  const mejor = parametrosAgencia(base, 1, { pase: { CONSUMO: 0.006, MICROCREDITO: 0.03 }, rv: { CONSUMO: 0.04, MICROCREDITO: 0.04 } }, ref);
  assert.ok(Math.abs(mejor.CONSUMO.M1.fr.base - base.CONSUMO.M1.fr.base * 0.5) < 1e-12);
  assert.equal(mejor.CONSUMO.M2.fr.base, base.CONSUMO.M2.fr.base);
});

// ---------- 4. Ritmo de la agencia: con poco saldo usa el de la cooperativa; los % quedan entre 0 y 100 ----------
test("el ritmo propio usa el de la cooperativa en tramos con poco saldo y nunca sale de 0–100 %", () => {
  const coop = parametros();
  const historia: CorteAgencia[] = Array.from({ length: 6 }, (_, i) => ({ periodo: `2026-${String(i + 5).padStart(2, "0")}`, saldo: saldos(i % 2 ? 1.1 : 0.9) }));
  const pequena: CorteAgencia[] = historia.map((c) => ({ ...c, saldo: saldos(0.01) }));
  const r = calibrarRitmoAgencia({ cooperativa: coop, historia: pequena, factorOptimista: 0.8, factorPesimista: 1.25, meses: 4 });
  assert.ok(r);
  for (const p of PRODUCTOS) for (const t of Object.values(r!.ritmo.tramos[p])) {
    assert.equal(t.propio, false, `${p}: con poco saldo debe usar el de la cooperativa`);
  }
  const g = calibrarRitmoAgencia({ cooperativa: coop, historia, factorOptimista: 0.8, factorPesimista: 1.25, meses: 4 })!;
  for (const p of PRODUCTOS) for (const k of TRAMOS[p]) {
    const x = g.parametros[p][k].fr;
    for (const v of [x.optimista, x.base, x.pesimista]) assert.ok(v >= 0 && v <= 1, `${p} ${k} fuera de 0–100 %`);
  }
});

// ---------- 5. Meta propuesta de provisión ----------
test("la meta propuesta no exige a quien está en el promedio o debajo, y no baja la provisión más de 20 %", () => {
  assert.equal(metaPropuesta(0.30, 0.34), 0.30);
  assert.equal(metaPropuesta(0.343, 0.34), 0.343);
  assert.ok(Math.abs(metaPropuesta(0.56, 0.34) - 0.45) < 1e-9);
  assert.ok(Math.abs(metaPropuesta(0.94, 0.34) - 0.94 * 0.8) < 1e-9);
});

// ---------- 6. La misma mejora no se cuenta dos veces ----------
test("si las metas de cartera ya alcanzan la meta de provisión, no se pide meta de ritmo", () => {
  assert.equal(faltaParaMeta(80_000, 90_000), 0);
  assert.equal(faltaParaMeta(100_000, 90_000), 10_000);
});

// ---------- 7. Idóneo de cartera ----------
test("el idóneo nunca es peor que el real (pase: más bajo es mejor; recuperación: más alto es mejor)", () => {
  // pase: mejor nivel peor que el real → queda el real
  assert.deepEqual(elegirIdoneo({ real: 0.0048, mejor: 0.0241, tope: 0.0104, eq: null, altoEsMejor: false, conPerdidaSinAlcance: false }).valor, 0.0048);
  // pase: el mejor nivel es el más exigente
  assert.equal(elegirIdoneo({ real: 0.0545, mejor: 0.0246, tope: 0.0142, eq: null, altoEsMejor: false, conPerdidaSinAlcance: false }).valor, 0.0246);
  // recuperación: no baja del real
  assert.equal(elegirIdoneo({ real: 0.85, mejor: 0.80, tope: 0.84, eq: null, altoEsMejor: true, conPerdidaSinAlcance: false }).valor, 0.85);
});
test("con pérdida y equilibrio inalcanzable se pide su mejor mes y se marca", () => {
  const r = elegirIdoneo({ real: 0.0112, mejor: 0.006, tope: 0.0055, eq: null, altoEsMejor: false, conPerdidaSinAlcance: true });
  assert.equal(r.valor, 0.0055); assert.equal(r.fuente, "tope"); assert.equal(r.noAlcanza, true);
  const v = elegirIdoneo({ real: 0.033, mejor: 0.036, tope: 0.04, eq: 0.725, altoEsMejor: true, conPerdidaSinAlcance: false });
  assert.equal(v.valor, 0.04); assert.equal(v.noAlcanza, true);
});

// ---------- 8. Los controles de Integridad detectan los errores ----------
function flow(g: number, prov: number): FlowAgencia {
  const cero = () => Array(12).fill(0) as number[];
  const productos = Object.fromEntries(PRODUCTOS.map((p) => [p, { gastoNeto: cero(), gasto4402: cero(), reversion: cero() }])) as FlowAgencia["escenarios"]["base"]["productos"];
  productos.CONSUMO.gastoNeto[0] = g; productos.CONSUMO.gasto4402[0] = g;
  const lineas = Object.fromEntries(PRODUCTOS.map((p) => [p, { saldo1499: Array(12).fill(p === "CONSUMO" ? prov : 0) }])) as FlowAgencia["lineas"];
  return { escenario: "base", escenarios: { base: { productos }, optimista: { productos }, pesimista: { productos } }, lineas };
}
const nodo = (codigo: string, v: number, hijos: { codigo: string; valores: number[] }[] = []) => ({ codigo, valores: Array(12).fill(v), hijos });
test("Integridad marca el descuadre de la provisión con el Estado de resultados y el Balance", () => {
  const ok = controlesProvision({
    agencias: [{ agencia: "A", clave: "A", flow: flow(1000, 5000),
      er: { cuentas: { egresos: nodo("4", 1000, [nodo("4402", 1000)]), ingresos: nodo("5", 0, [nodo("560410", 0)]) } },
      bal: { activo: nodo("1", 0, [nodo("1499", -4990, [{ codigo: "", valores: Array(12).fill(-5000) }, nodo("149987", 10)])]) } }],
    ventanaDesde: "2026-06", ritmoDesde: { A: "2026-06" }, real: { desde: "2026-06", porOficina: { A: { valor: 1000 } } },
  });
  assert.equal(ok.find((c) => c.id === "prov-cuadre")!.estado, "ok");
  assert.equal(ok.find((c) => c.id === "prov-meses")!.estado, "ok");
  const mal = controlesProvision({
    agencias: [{ agencia: "A", clave: "A", flow: flow(1000, 5000),
      er: { cuentas: { egresos: nodo("4", 900, [nodo("4402", 900)]), ingresos: nodo("5", 0, [nodo("560410", 0)]) } },
      bal: { activo: nodo("1", 0, [nodo("1499", -6000)]) } }],
    ventanaDesde: "2026-06", ritmoDesde: { A: "2026-01" }, real: { desde: "2026-01", porOficina: { A: { valor: 5000 } } },
  });
  assert.equal(mal.find((c) => c.id === "prov-cuadre")!.estado, "error");
  assert.equal(mal.find((c) => c.id === "prov-meses")!.estado, "error");
  assert.equal(mal.find((c) => c.id === "prov-razonable")!.estado, "aviso");
});

// ---------- 9. Meses: el tramo E no toma meses antes de la ventana; el ER sale de Históricos y sigue al último mes ----------
test("el tramo E y los castigos nunca empiezan antes de la ventana (aunque falte el ER del último mes)", () => {
  const meses = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const historia = { saldo: Object.fromEntries(meses.map((m) => [m, saldos(1)])), prov: Object.fromEntries(meses.map((m) => [m, saldos(0.1)])) };
  const eerr = meses.slice(0, 6).map((periodo) => ({ periodo, g4402: 100_000, r560410: 1_000, r560405: 0 })); // sin octubre
  const c = recalibrar({ historia, eerr, ventanaDesde: "2026-06", ventanaHasta: "2026-10", factorOptimista: 0.8, factorPesimista: 1.25, parametrosActuales: parametros() });
  assert.deepEqual(c.ventanaE, ["2026-06", "2026-07", "2026-08", "2026-09"]);
});
test("el ER del modelo sale de Históricos (Consolidado o las 10 agencias) y mensualiza el acumulado, también diciembre", async () => {
  const filas: Record<string, unknown>[] = [];
  const ag = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];
  for (const [per, acum] of [["2026-09", 900], ["2026-10", 1000], ["2026-11", 1100], ["2026-12", 1300]] as const) {
    if (per === "2026-12") ag.forEach((o) => filas.push({ oficina: o, periodo: per, codigo: "4402", valor: acum / 10 })); // diciembre solo por agencias
    else filas.push({ oficina: "Consolidado", periodo: per, codigo: "4402", valor: acum });
  }
  const db = { execute: async () => ({ rows: filas }) } as unknown as Parameters<typeof eerrDeHistoricos>[0];
  const r = await eerrDeHistoricos(db);
  assert.deepEqual(r.map((m) => [m.periodo, Math.round(m.g4402)]), [["2026-10", 100], ["2026-11", 100], ["2026-12", 200]]);
});
test("Integridad marca el tramo E con meses de alivio y el ER del modelo atrasado", () => {
  const r = controlesProvision({ agencias: [], ventanaDesde: "2026-06", ritmoDesde: {}, real: { desde: "2026-06", hasta: "2026-10", porOficina: {} },
    ventanaE: ["2026-05", "2026-06"], erModeloHasta: "2026-09", ventanaHasta: "2026-09", ultimoCorte: "2026-10" });
  const m = r.find((c) => c.id === "prov-meses")!;
  assert.equal(m.estado, "error");
  assert.equal(m.hallazgos.length, 3);
});

// ---------- 10. Idóneo gradual, sin meses atípicos y con límite de 25 % en la provisión ----------
import { calcularIdoneo, gradual, LIMITE_BAJA_PROVISION } from "../lib/calc/idoneo-cartera";
import type { MesReal, VersionCartera } from "../lib/calc/estudio-agencia";
import type { Corrida } from "../lib/calc/plan2027";
test("la meta gradual cierra la mitad de la distancia hacia el mejor nivel", () => {
  assert.ok(Math.abs(gradual(0.02, 0.01, false)! - 0.015) < 1e-12);  // pase: más bajo es mejor
  assert.ok(Math.abs(gradual(0.80, 0.90, true)! - 0.85) < 1e-12);    // recuperación: más alto es mejor
  assert.equal(gradual(0.02, 0.03, false), 0.03);                     // mejor nivel peor que el real: no se usa (elegirIdoneo deja el real)
});
test("con el idóneo la provisión de la agencia no baja más de 25 % y los meses atípicos no cuentan", () => {
  // pase real 2 %; un mes atípico casi en cero (0,1 %) no debe contar como su mejor nivel
  const pases = [0.022, 0.010, 0.009, 0.025, 0.001, 0.024];
  const ms = pases.map((x, k) => ({ p: `2026-${String(k + 5).padStart(2, "0")}`, pv0: [0, 1_000_000], mig: [0, x * 1_000_000], rep: { capital: 100, neto: 80, capVen: 100, netoVen: 3 } })) as unknown as MesReal[];
  const pres = { tasa: [0.1, 0.15], e: [0.8, 0.8], rv: [0.03, 0.03], dist: [0, 1], p: [0.03, 0.03], q: [0, 0], pase: [0, 0.02], cumpl: 1, ases: 1, fm: 1 } as VersionCartera;
  // provisión proporcional al pase; la agencia pierde con su real → el equilibrio pediría bajar mucho el pase
  const correr = (v: VersionCartera) => { const prov = v.pase[1] * 20_000_000; return { er: { util: 100_000 - prov, provCart: prov, reversion: 0 } } as unknown as Corrida; };
  const c = calcularIdoneo({ ms, idx: [1], pres, correr, desde: "" })!;
  const f = c.filas.find((x) => x.clave === "pase1")!;
  assert.ok(f.tope! > 0.005, "el mes atípico (0,1 %) no es su mejor mes");
  assert.ok(c.bajaProvision <= LIMITE_BAJA_PROVISION + 1e-3, `la provisión baja ${c.bajaProvision}`);
  assert.equal(c.limitado, true);
});

// ---------- 11. Nómina: décimos, fondo de reserva e IESS ----------
import { calcularTotalesNomina, calcularLineasProvisionMensuales, extrasNominaPorMes } from "../lib/calc/th1";
test("nómina: décimo tercero = un mes de sueldo, décimo cuarto = SBU × empleados ÷ 12, fondo 8,33 % e IESS 12,15 %", () => {
  const p = { sbu: 482, iess_patronal: 0.1215, fondo_reserva: 0.0833, fondo_liquidez_pct: 0.059, fondo_liquidez_meta: 0.075 };
  const emp = [{ nombre: "A", basico2025: 1000, incrementoPct: 0, movilizacionAnual: 0 }, { nombre: "B", basico2025: 2000, incrementoPct: 0.05, movilizacionAnual: 0 }];
  const t = calcularTotalesNomina(emp, p);
  const nominaMes = 1000 + 2100;
  assert.ok(Math.abs(t.decimoTerceroAnualTotal - nominaMes) < 1e-6, "décimo tercero del año = un mes de nómina");
  assert.equal(t.decimoCuartoAnualTotal, 482 * 2);
  const cero = Array(12).fill(0);
  const extras = { horasExtrasPorMes: Array(12).fill(2000), comisionesPorMes: Array(12).fill(1000), subrogacionesPorMes: Array(12).fill(500), otrosGastosPersonalPorMes: Array(12).fill(300) };
  const x = extrasNominaPorMes(extras, p);
  assert.equal(x.base[0], 3500, "otros gastos del personal no entra en la base");
  assert.ok(Math.abs(x.iessPatronal[0] - 425.25) < 1e-9);
  assert.ok(Math.abs(x.fondoReserva[0] - 291.55) < 1e-9);
  assert.ok(Math.abs(x.decimoTercero[0] - 3500 / 12) < 1e-9);
  const l = calcularLineasProvisionMensuales(t, extras, p);
  assert.ok(Math.abs(l.decimoCuartoPorMes[0] - 482 * 2 / 12) < 1e-9);
  assert.ok(Math.abs(l.decimoTerceroPorMes[0] - (nominaMes / 12 + 3500 / 12)) < 1e-9);
  assert.ok(Math.abs(l.iessPatronalPorMes[0] - (nominaMes * 12 * 0.1215 / 12 + 425.25)) < 1e-9);
  assert.ok(Math.abs(l.fondoReservaPorMes[0] - (nominaMes * 12 * 0.0833 / 12 + 291.55)) < 1e-9);
  const sin = calcularLineasProvisionMensuales(t, { horasExtrasPorMes: cero, comisionesPorMes: cero, subrogacionesPorMes: cero, otrosGastosPersonalPorMes: cero }, p);
  assert.ok(Math.abs(sin.sueldoPorMes[0] - nominaMes) < 1e-9);
});

// ---------- 12. Precancelación real en el idóneo y tasa real con el interés refinanciado ----------
import { versionIdoneo } from "../lib/calc/idoneo-cartera";
import { calcularRealidad } from "../lib/calc/estudio-agencia";
test("el idóneo pone la precancelación real en todos los productos y la vencida sigue su ritmo real", () => {
  const ms = [0.02, 0.018, 0.022].map((x, k) => ({ p: `2026-0${k + 6}`, pv0: [0, 1_000_000, 0, 500_000], mig: [0, x * 1e6, 0, x * 5e5],
    rep: { capital: 100_000, neto: 85_000, prec: 15_000, refin: 0, recVen: 0, capVen: 100, netoVen: 3, precVen: 0 } })) as unknown as MesReal[];
  const pres = { tasa: [0.1, 0.15, 0.1, 0.2], e: [0.8, 0.8, 0.8, 0.8], rv: [0.03, 0.03, 0.03, 0.03], dist: [0, 0.8, 0, 0.2], p: [0.03, 0.03, 0.03, 0.03], q: [0, 0.005, 0, 0.004], pase: [0, 0.02, 0, 0.02], cumpl: 1, ases: 1, fm: 1 } as VersionCartera;
  const correr = (v: VersionCartera) => ({ er: { util: 100_000, provCart: 1000, reversion: 0 } }) as unknown as Corrida;
  const c = calcularIdoneo({ ms, idx: [1, 3], pres, correr, desde: "" })!;
  const q = c.filas.find((f) => f.clave === "q")!;
  assert.ok(Math.abs(q.real! - 15_000 / 1_500_000) < 1e-12, "precancelación real = precancelado ÷ cartera por vencer");
  const v = versionIdoneo(c);
  assert.deepEqual(v.q.map((x) => Math.round(x * 1e6)), [10_000, 10_000, 10_000, 10_000], "un solo valor para todos los productos");
  assert.equal(v.qvReal, true);
  assert.equal(versionIdoneo(c, { q: 0.008 }).q[3], 0.008, "la meta escrita se aplica a todos los productos");
});
test("la tasa real de cada línea incluye su parte del interés refinanciado y reestructurado", () => {
  const bal = { "1402": 900_000, "1410": 100_000, "1404": 500_000 };
  const h = { agencia: "A", bal: { "2026-05": bal, "2026-06": bal }, er: { "2026-05": { "510410": 0, "510420": 0, "510430": 0 }, "2026-06": { "510410": 10_000, "510420": 7_000, "510430": 1_000 } } } as unknown as Parameters<typeof calcularRealidad>[0];
  const r = calcularRealidad(h, { p: [0.03, 0.03, 0.03, 0.03], rv: [0, 0, 0, 0], meta: 0 })!;
  // consumo: (10.000 + 1.000 del refinanciado, todo de consumo) × 12 ÷ 1.000.000
  assert.ok(Math.abs(r.lineas[1].tasa! - 0.132) < 1e-9, `consumo ${r.lineas[1].tasa}`);
  assert.ok(Math.abs(r.lineas[3].tasa! - 7_000 * 12 / 500_000) < 1e-9);
});
test("interés de mora real = 5104.50 ÷ interés normal de la cartera (meses con los dos datos)", async () => {
  const { moraReal } = await import("../lib/calc/estudio-agencia");
  const ms = [{ intMora: 20, int5104: 1520 }, { intMora: 10, int5104: 1010 }, { intMora: null, int5104: 999 }] as unknown as MesReal[];
  assert.ok(Math.abs(moraReal(ms)! - 30 / 2500) < 1e-12);
});
test("interés de mora automático: real de los meses sin alivio, restando el acumulado del mes anterior a la ventana", async () => {
  const { interesMoraRealAgencia } = await import("../lib/interes-mora-db");
  const filas = [
    ["2026-05", "5104", 500_000], ["2026-05", "510450", 8_000], ["2026-05", "510410", 300_000],
    ["2026-08", "5104", 900_000], ["2026-08", "510450", 14_000], ["2026-08", "510410", 540_000],
  ].map(([periodo, codigo, valor]) => ({ periodo, codigo, valor }));
  const db = { batch: async () => [], executeMultiple: async () => undefined, execute: async (q: { sql?: string } | string) => (String(typeof q === "string" ? q : q.sql).includes("historico_cuentas") ? { rows: filas } : { rows: [] }) };
  const r = await interesMoraRealAgencia(db as never, "A");
  // (14.000 − 8.000) ÷ ((900.000 − 500.000) − 6.000)
  assert.ok(r, "con la ventana por defecto debe calcularse");
  assert.ok(Math.abs(r!.valor - 6_000 / 394_000) < 1e-12, `valor ${r!.valor}`);
});

test("tope de tasa por línea: tasa más alta del producto en base 360", async () => {
  const { TOPE_TASA_LINEA, FACTOR_BASE_360 } = await import("../lib/calc/estudio-agencia");
  // 15,50 % × 365 ÷ 360 = 15,72 % (tabla de amortización de consumo: interés = saldo × tasa × días ÷ 360)
  assert.equal(Math.round(0.155 * FACTOR_BASE_360 * 10000) / 100, 15.72);
  assert.deepEqual(TOPE_TASA_LINEA.map((x) => Math.round(x * 10000) / 100), [10.8, 15.82, 9.94, 19.25]);
});

test("puente de provisión: real + pasos = presupuesto; diagnóstico con la identidad de la provisión", async () => {
  const { puenteAgencia, diagnosticoAgencia, sumarPuentes } = await import("../lib/calc/diagnostico-provision");
  const vacio = { CONSUMO: {}, MICROCREDITO: {}, INMOBILIARIO: {}, PRODUCTIVO: {} } as never;
  const tot = { CONSUMO: Array(12).fill(0), MICROCREDITO: Array(12).fill(0), INMOBILIARIO: Array(12).fill(0), PRODUCTIVO: Array(12).fill(0) } as never;
  const s = { inicial: vacio, castigoPorProducto: { CONSUMO: 0, MICROCREDITO: 0, INMOBILIARIO: 0, PRODUCTIVO: 0 }, totales: tot, parametros: vacio, parametrosSinMejoras: vacio, parametrosSoloPase: vacio, parametrosCartera: vacio } as never;
  const p = puenteAgencia(s, "base", 0, 120_000, 13_000);
  assert.equal(Math.round((p.real + p.cartera + p.pase + p.recuperacion + p.meta) * 100), Math.round(p.presupuesto * 100));
  assert.equal(p.presupuesto, 10_000);
  const q = sumarPuentes([p, p]);
  assert.equal(q.real, 26_000);
  // diagnóstico: 2 meses (jun y jul) con su mes anterior (may)
  const bal = (pv: number, r: number, prov: number) => ({ "1402": pv, "1426": r, "1499": -prov });
  const h = { agencia: "X", bal: { "2026-05": bal(1_000_000, 50_000, 40_000), "2026-06": bal(1_010_000, 55_000, 43_000), "2026-07": bal(1_020_000, 56_000, 44_000) },
    er: { "2026-05": { "4402": 10_000, "560410": 0 }, "2026-06": { "4402": 15_000, "560410": 1_000 }, "2026-07": { "4402": 20_000, "560410": 1_000 } } } as never;
  const d = diagnosticoAgencia(h, "2026-06")!;
  assert.equal(d.meses, 2); assert.equal(d.provInicio, 40_000); assert.equal(d.provFin, 44_000);
  assert.equal(Math.round(d.mora! * 10000), Math.round(56_000 / 1_076_000 * 10000));
  // castigos de junio: 40.000 + (5.000 − 1.000) − 43.000 = 1.000
  assert.equal(d.porMes[0].castigos, 1_000);
});

test("ajuste al real: factor del ritmo que reproduce el gasto real al mes", async () => {
  const { ajusteAlReal, AJUSTE_MAX } = await import("../lib/calc/provision-flow");
  const g = (k: number) => 120_000 * k; // gasto del año proporcional al ritmo
  assert.equal(Math.round(ajusteAlReal(g, 15_000)! * 1000) / 1000, 1.5);
  assert.equal(ajusteAlReal(g, 1_000_000), AJUSTE_MAX);
  assert.equal(ajusteAlReal(g, null), null);
});

test("meta de morosidad: esfuerzo parejo y todas mejoran", async () => {
  const { resolverTodasMejoran } = await import("../lib/calc/meta-morosidad");
  // riesgo = r0 × max(f, piso); con recuperación extra s el riesgo baja r0 × s
  const ag = (agencia: string, riesgo: number, bruta: number, piso: number, hoy: number) => ({ agencia, hoy, brutaHoy: bruta, riesgo, bruta, util: 0,
    correr: (f: number) => { const g = Math.max(f, piso); return { mora: (riesgo * g) / bruta, riesgo: riesgo * g, bruta, util: 0 }; },
    correrExtra: (s: number) => { const g = Math.max(0, piso - s); return { mora: (riesgo * g) / bruta, riesgo: riesgo * g, bruta, util: 0 }; }, extraMax: 0.5 });
  // A ya mejora con el esfuerzo parejo; B (hoy 3 %, presupuesto 10 %) necesita más: queda en su objetivo
  const r = resolverTodasMejoran([ag("A", 25, 100, 0.2, 0.25), ag("B", 10, 100, 0.5, 0.03)], 0.12);
  const b = r.agencias[1];
  assert.ok(r.mejoraMinima > 0 && b.objetivo !== null && b.mora <= b.objetivo + 1e-4, `B ${b.mora} obj ${b.objetivo}`);
  assert.ok(b.extra > 0 && !b.noAlcanza, "B sube su recuperación sobre su mejor mes");
  assert.ok(Math.abs(r.mora - 0.12) < 0.002 && r.alcanzable, `mora ${r.mora}`);
  for (const x of r.agencias) assert.ok(x.mora <= (x.hoy ?? 1) + 1e-6, `${x.agencia} no empeora`);
  // meta imposible
  const no = resolverTodasMejoran([ag("A", 25, 100, 0.9, 0.25), ag("B", 5, 100, 0.9, 0.05)], 0.01);
  assert.equal(no.alcanzable, false);
});

test("recuperación de vencida sobre la real: sale de los tramos en riesgo y libera su provisión", async () => {
  const { proyectarProvisionFlow, parametrosAgencia, TRAMOS } = await import("../lib/calc/provision-flow");
  const tasa: Record<string, number> = { V: 0.01, M1: 0.04, M2: 0.14, M3: 0.45, M4: 1, E: 1 };
  const par = { CONSUMO: Object.fromEntries(TRAMOS.CONSUMO.map((t) => [t, { n: 1, tasa: tasa[t], fr: { optimista: 0.3, base: 0.3, pesimista: 0.3 } }])) } as never;
  const ini = { CONSUMO: { V: 900, M1: 30, M2: 20, M3: 15, M4: 10, E: 100 } } as never;
  const ref = { pase: {}, rv: 0.04, desde: "2026-07", hasta: "2026-10" };
  const correr = (sup: { pase: object; rv: object } | null) => {
    const p = parametrosAgencia(par, 1, sup as never, ref as never);
    const r = proyectarProvisionFlow({ parametros: p, escenario: "base", inicial: ini, castigoMensualPorProducto: { CONSUMO: 0 } as never, mesesPuente: 0, totalesEjercicio: null, restarCastigos: false });
    return r.CONSUMO;
  };
  const igual = correr({ pase: {}, rv: { CONSUMO: 0.04 } }), mas = correr({ pase: {}, rv: { CONSUMO: 0.06 } });
  // igual al real: el modelo no cambia
  assert.equal(Math.round(igual.provision[11] * 1000), Math.round(correr(null).provision[11] * 1000));
  // 2 puntos más de recuperación: menos saldo en E y menos provisión
  assert.ok(mas.saldoE[11] < igual.saldoE[11] && mas.provision[11] < igual.provision[11]);
});
