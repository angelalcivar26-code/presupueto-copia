import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { AGENCIAS_CONSOLIDADO } from "../../../lib/consolidado";

/**
 * BALANCE DE PARTIDA del presupuesto: el balance de cada agencia desde el que arranca el ejercicio (saldos_iniciales).
 * Ya no se sube aparte: se toma de los balances cargados en Carga de datos → Balances (historico_cuentas).
 *  GET ?ejercicio=2027 → por agencia: partida actual, último balance cargado antes del ejercicio y partidas guardadas.
 *  POST { agencias: string[], ejercicio } → usa como partida el último balance cargado antes del ejercicio.
 * La partida es el último balance guardado antes de enero del ejercicio (lib/insumos-agencia.ts → resolverCorteSaldos).
 */
const per = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;
const grupo = (c: string) => ({ "1": "ACTIVO", "2": "PASIVO", "3": "PATRIMONIO", "4": "GASTO", "5": "INGRESO" } as Record<string, string>)[c[0]] ?? "ACTIVO";

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const [ags, cargas, ultimos] = await Promise.all([
      db.execute(`SELECT id, nombre FROM agencias ORDER BY id`),
      db.execute(`SELECT c.agencia_id, c.anio, c.mes, (SELECT COUNT(*) FROM saldos_iniciales s WHERE s.agencia_id = c.agencia_id AND s.anio = c.anio AND s.mes = c.mes) AS n
                  FROM saldos_cargas c ORDER BY c.anio DESC, c.mes DESC`),
      db.execute({ sql: `SELECT oficina, MAX(periodo) AS periodo FROM historico_resumen WHERE bal > 0 AND periodo < ? GROUP BY oficina`, args: [per(ejercicio, 1)] }),
    ]);
    const id = new Map<string, number>();
    for (const r of ags.rows) if (!id.has(String(r.nombre))) id.set(String(r.nombre), Number(r.id)); // el primero, como resolverAgenciaId
    const agencias = AGENCIAS_CONSOLIDADO.map((nombre) => {
      const agId = id.get(nombre) ?? null;
      const propias = cargas.rows.filter((r) => Number(r.agencia_id) === agId).map((r) => ({ anio: Number(r.anio), mes: Number(r.mes), cuentas: Number(r.n) || 0 }));
      const partida = propias.find((c) => c.anio < ejercicio) ?? null;
      const ultimo = ultimos.rows.find((r) => String(r.oficina) === nombre);
      return { agencia: nombre, agenciaId: agId, partida, guardadas: propias, ultimoBalance: ultimo ? String(ultimo.periodo) : null };
    });
    return NextResponse.json({ ejercicio, agencias });
  } catch (e) {
    console.error("[balance-partida]", e);
    return NextResponse.json({ error: "No se pudo leer el balance de partida" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = (await req.json()) as { agencias?: string[]; ejercicio?: number };
    const ejercicio = Number(body.ejercicio) || (await ejercicioDe(req));
    const lista = (body.agencias ?? []).filter((a) => AGENCIAS_CONSOLIDADO.includes(a));
    if (!lista.length) return NextResponse.json({ error: "Elija al menos una agencia." }, { status: 400 });
    const hechas: { agencia: string; periodo: string; cuentas: number }[] = [], sinBalance: string[] = [];
    for (const agencia of lista) {
      const u = await db.execute({ sql: `SELECT MAX(periodo) AS periodo FROM historico_cuentas WHERE oficina = ? AND tipo = 'BAL' AND periodo < ?`, args: [agencia, per(ejercicio, 1)] });
      const periodo = u.rows[0]?.periodo ? String(u.rows[0].periodo) : null;
      if (!periodo) { sinBalance.push(agencia); continue; }
      const [anio, mes] = periodo.split("-").map(Number);
      const ag = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ? ORDER BY id LIMIT 1`, args: [agencia] });
      const agId = Number(ag.rows[0]?.id);
      if (!agId) { sinBalance.push(agencia); continue; }
      const filas = await db.execute({
        sql: `SELECT h.codigo, h.valor, c.nombre FROM historico_cuentas h LEFT JOIN catalogo_cuentas c ON c.codigo = h.codigo
              WHERE h.oficina = ? AND h.periodo = ? AND h.tipo = 'BAL'`,
        args: [agencia, periodo],
      });
      // mismo guardado que la carga de saldos: reemplaza ese mes completo, en un solo lote
      const stmts: { sql: string; args: (string | number)[] }[] = [{ sql: `DELETE FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agId, anio, mes] }];
      for (const r of filas.rows) {
        const codigo = String(r.codigo);
        stmts.push({
          sql: `INSERT INTO catalogo_cuentas (codigo, nombre, grupo, nivel) VALUES (?, ?, ?, ?) ON CONFLICT(codigo) DO NOTHING`,
          args: [codigo, r.nombre ? String(r.nombre) : codigo, grupo(codigo), codigo.length],
        });
        stmts.push({ sql: `INSERT INTO saldos_iniciales (agencia_id, cuenta_codigo, anio, mes, monto) VALUES (?, ?, ?, ?, ?)`, args: [agId, codigo, anio, mes, Number(r.valor) || 0] });
      }
      // registro de la carga (borrar e insertar: no depende de que la tabla tenga índice único)
      stmts.push({ sql: `DELETE FROM saldos_cargas WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agId, anio, mes] });
      stmts.push({ sql: `INSERT INTO saldos_cargas (agencia_id, anio, mes, registros_count, cargado_en) VALUES (?, ?, ?, ?, datetime('now'))`, args: [agId, anio, mes, filas.rows.length] });
      await db.batch(stmts, "write"); // todo o nada
      hechas.push({ agencia, periodo, cuentas: filas.rows.length });
    }
    return NextResponse.json({ ok: true, hechas, sinBalance });
  } catch (e) {
    console.error("[balance-partida]", e);
    return NextResponse.json({ error: "No se pudo guardar el balance de partida" }, { status: 500 });
  }
}
