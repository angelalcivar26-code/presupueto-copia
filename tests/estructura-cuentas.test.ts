/**
 * Códigos contables del activo fijo: cada bien en su cuenta y las cuentas madre intermedias armadas por nivel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { anidarPorCodigo, CODIGO_AF } from "../lib/calc/orquestador";

const v = (n: number) => Array(12).fill(n);
test("la depreciación acumulada queda bajo 1899 con sus cuentas reales", () => {
  const filas = Object.entries(CODIGO_AF).map(([label, c], i) => ({ codigo: c.dep, label, valores: v(i + 1) }));
  const arbol = anidarPorCodigo("1899", filas);
  assert.deepEqual(arbol.map((n) => n.codigo), ["189905", "189915", "189920", "189925", "189940"]);
  const muebles = arbol.find((n) => n.codigo === "189915")!;
  assert.deepEqual(muebles.hijos!.map((n) => n.codigo), ["18991501", "18991502", "18991503"]);
  assert.equal(muebles.valores[0], 2 + 3 + 4);
});
test("el costo: muebles, equipos y enseres en 1805 → 180505", () => {
  const filas = [{ codigo: "1801", label: "Terrenos", valores: v(1) }, ...Object.entries(CODIGO_AF).map(([label, c]) => ({ codigo: c.costo, label, valores: v(1) }))];
  const arbol = anidarPorCodigo("18", filas);
  assert.deepEqual(arbol.map((n) => n.codigo), ["1801", "1802", "1805", "1806", "1807", "1890"]);
  assert.equal(arbol[2].hijos![0].codigo, "180505");
  assert.equal(arbol[2].hijos![0].hijos!.length, 3);
  assert.equal(arbol[2].valores[5], 3);
  // cada gasto de depreciación en una cuenta 4505 distinta (otros activos en 450590, no en otros locales)
  assert.equal(CODIGO_AF["Otros Activos"].gasto, "450590");
});
