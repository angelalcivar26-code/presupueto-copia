/**
 * Panel "Actualizar la base" (diciembre): meses atípicos, bases a comparar y recomendación con límites.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesesAtipicos, basesCandidatas, recomendarBase, evaluarBase, type ResultadoBase } from "../lib/calc/base-calibracion";
import { ventanaDeTexto, conVentana, ventanaSimulada, sufijoVentana } from "../lib/ventana-simulada";

const base = { desde: "2026-07", hasta: "2026-10" };
const res = (id: ResultadoBase["id"], pres: number, mora: number, ags: [string, number][]): ResultadoBase =>
  ({ id, pres, mora, util: 0, agencias: ags.map(([a, p]) => ({ a, pres: p })) });

test("mes atípico: gasto o castigos más de 1,5 veces la mediana", () => {
  const s = [
    { p: "2026-07", gasto: 450000, castigos: 340000 }, { p: "2026-08", gasto: 440000, castigos: 350000 },
    { p: "2026-09", gasto: 460000, castigos: 345000 }, { p: "2026-10", gasto: 455000, castigos: 355000 },
    { p: "2026-11", gasto: 470000, castigos: 330000 }, { p: "2026-12", gasto: 900000, castigos: 1200000 },
  ];
  const a = mesesAtipicos(s);
  assert.deepEqual(a.map((x) => x.p), ["2026-12"]);
  assert.equal(a[0].motivos.length, 2);
  assert.deepEqual(mesesAtipicos(s.slice(0, 5)), []);
});

test("sin meses nuevos solo se compara la base aprobada", () => {
  assert.deepEqual(basesCandidatas(base, "2026-10", []).map((b) => b.id), ["A"]);
});

test("con diciembre: A, B, D y C solo si diciembre es atípico", () => {
  const n = basesCandidatas(base, "2026-12", []);
  assert.deepEqual(n.map((b) => [b.id, b.desde, b.hasta]), [["A", "2026-07", "2026-10"], ["B", "2026-07", "2026-12"], ["D", "2026-09", "2026-12"]]);
  const c = basesCandidatas(base, "2026-12", ["2026-12"]);
  assert.deepEqual(c.map((b) => b.id), ["A", "B", "D", "C"]);
  assert.deepEqual(c.find((b) => b.id === "B")!.nuevosAtipicos, ["2026-12"]);
  assert.deepEqual(c.find((b) => b.id === "C")!.nuevosAtipicos, []);
});

test("recomienda la base con más meses dentro de los límites", () => {
  const cands = basesCandidatas(base, "2026-12", []);
  const r = recomendarBase(cands, [res("A", 386000, 0.132, [["Matriz", 100000]]), res("B", 400000, 0.135, [["Matriz", 110000]]), res("D", 380000, 0.13, [["Matriz", 98000]])]);
  assert.equal(r.id, "B");
});

test("cambio fuerte: se mantiene la base aprobada", () => {
  const cands = basesCandidatas(base, "2026-12", []);
  const A = res("A", 386000, 0.132, [["Matriz", 100000], ["Naranjal", 50000]]);
  const B = res("B", 450000, 0.132, [["Matriz", 100000], ["Naranjal", 50000]]);   // +16,6 %
  const D = res("D", 390000, 0.132, [["Matriz", 100000], ["Naranjal", 70000]]);   // Naranjal +40 %
  assert.equal(recomendarBase(cands, [A, B, D]).id, "A");
  assert.deepEqual(evaluarBase(D, A, cands[2]).agenciasFuera, ["Naranjal"]);
  // morosidad: más de 1 punto también saca a la base
  assert.equal(evaluarBase(res("B", 390000, 0.15, [["Matriz", 100000], ["Naranjal", 50000]]), A, cands[1]).dentro, false);
});

test("una base con un mes nuevo atípico no se recomienda", () => {
  const cands = basesCandidatas(base, "2026-12", ["2026-12"]);
  const A = res("A", 386000, 0.132, [["Matriz", 100000]]);
  const r = recomendarBase(cands, [A, res("B", 390000, 0.132, [["Matriz", 100000]]), res("D", 390000, 0.132, [["Matriz", 100000]]), res("C", 388000, 0.132, [["Matriz", 100000]])]);
  assert.equal(r.id, "C");
});

test("base simulada: solo en el cálculo pedido y con su propia clave", async () => {
  assert.equal(ventanaDeTexto("2026-07_2026-12")?.hasta, "2026-12");
  assert.equal(ventanaDeTexto("2026-12_2026-07"), null);
  assert.equal(ventanaDeTexto("x"), null);
  assert.equal(ventanaSimulada(), null);
  const dentro = await conVentana({ desde: "2026-07", hasta: "2026-12" }, async () => { await Promise.resolve(); return [ventanaSimulada()?.hasta, sufijoVentana()]; });
  assert.deepEqual(dentro, ["2026-12", "|base:2026-07_2026-12"]);
  assert.equal(sufijoVentana(), "");
});

test("gasto real de la base: mismo año y base que cruza de año", async () => {
  const { realDeLaBase } = await import("../lib/calc/base-calibracion");
  const f = (periodo: string, g: number, r: number) => [
    { oficina: "MATRIZ", periodo, codigo: "4402", valor: g }, { oficina: "MATRIZ", periodo, codigo: "560410", valor: r }, { oficina: "MATRIZ", periodo, codigo: "5104", valor: 10 * g }];
  // acumulado: 100 al mes de gasto, 10 de reversión
  const filas = [...f("2026-06", 600, 60), ...f("2026-10", 1000, 100), ...f("2026-11", 1100, 110), ...f("2026-12", 1200, 120), ...f("2027-01", 100, 10)];
  const a = realDeLaBase(filas, "2026-07", "2026-10");
  assert.equal(a.hasta, "2026-10");
  assert.equal(a.porOficina.MATRIZ.meses, 4);
  assert.equal(Math.round(a.porOficina.MATRIZ.valor), (400 - 40) * 12 / 4);
  // la base fija no toma noviembre aunque esté cargado
  assert.equal(realDeLaBase(filas, "2026-07", "2026-10").porOficina.MATRIZ.mes, 10);
  // jul-26 a ene-27: jul–dic (600 − 60) + ene (100 − 10) en 7 meses
  const c = realDeLaBase(filas, "2026-07", "2027-01");
  assert.equal(c.porOficina.MATRIZ.meses, 7);
  assert.equal(Math.round(c.porOficina.MATRIZ.valor), Math.round((540 + 90) * 12 / 7));
});
