/**
 * Base histórica («Cargar histórico»): lee los meses cargados (resumen con el número de cuentas, no un 1) y, cuando un
 * año viene a 6 dígitos y el siguiente a 8, la subcuenta no toma los meses de 6 dígitos como cero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseHistorica } from "../lib/base-historica";

test("base de 12 meses con 2025 a 6 dígitos y 2026 a 8 dígitos", async () => {
  const filas: { oficina: string; periodo: string; codigo: string; valor: number }[] = [];
  const meses: { oficina: string; periodo: string }[] = [];
  for (let m = 1; m <= 12; m++) { const p = `2025-${String(m).padStart(2, "0")}`; filas.push({ oficina: "Matriz", periodo: p, codigo: "450105", valor: 100 * m }); meses.push({ oficina: "Matriz", periodo: p }); }
  for (let m = 1; m <= 10; m++) {
    const p = `2026-${String(m).padStart(2, "0")}`;
    filas.push({ oficina: "Matriz", periodo: p, codigo: "450105", valor: 110 * m }, { oficina: "Matriz", periodo: p, codigo: "45010505", valor: 110 * m });
    meses.push({ oficina: "Matriz", periodo: p });
  }
  const db = { execute: async (q: string | { sql: string }) => {
    const sql = typeof q === "string" ? q : q.sql;
    if (sql.includes("historico_resumen")) return { rows: meses };
    if (sql.includes("catalogo_cuentas")) return { rows: [] };
    return { rows: filas };
  } };
  const r = await baseHistorica(db, 2027, "45", ["Matriz"]);
  const madre = r.find((x) => x.codigo === "450105")!, sub = r.find((x) => x.codigo === "45010505")!;
  // madre: 12 meses = 2026 ene–oct (1.100) + 2025 nov–dic (200)
  assert.equal(madre.base_ttm, 1300);
  // subcuenta: 2025 no tiene su detalle → se anualiza lo de 2026 (1.100 × 12 ÷ 10), no 1.100 + 0
  assert.equal(sub.base_ttm, 1320);
  assert.equal(sub.detalle, true);
});
