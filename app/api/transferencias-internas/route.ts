import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { asegurarTablaPrestamosInternos, leerTransferenciasInternas, proyectarPrestamoTI } from "../../../lib/prestamos-internos";
import { mesTermina, OFICINAS } from "../../../lib/calc/prestamos-internos";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * Transferencias internas (1908 / 2908) de las 10 oficinas.
 * GET ?ejercicio=2027 → { tasa, oficinas (transaccionalidad por contraparte), prestamos (con su proyección en los libros de
 *   la que presta y de la que recibe) }
 * POST { accion: "abono", prestamista, deudora, abono | null }  → abono mensual del préstamo (null = el del último mes)
 * POST { accion: "nuevo", id?, prestamista, deudora, mes, monto, descripcion } → préstamo nuevo en el ejercicio
 * POST { accion: "eliminar", id }
 * La tasa se guarda con /api/otros-pasivo-parametros (ingresos_tasa_prestamos_internos, todas las agencias).
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const d = await leerTransferenciasInternas(db, ejercicio);
    const t = Array(12).fill(d.tasa);
    const prestamos = d.prestamos.map((p) => {
      const presta = proyectarPrestamoTI(p, "presta", t, ejercicio), recibe = proyectarPrestamoTI(p, "recibe", t, ejercicio);
      return { ...p, presta, recibe, termina: mesTermina(p.saldoPresta, p.abono, ejercicio, presta.nuevos) };
    });
    return NextResponse.json({ ...d, prestamos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo las transferencias internas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    await asegurarTablaPrestamosInternos(db);
    const b = await req.json();
    const ejercicio = await ejercicioDe(req, b);
    const valida = (n: unknown) => OFICINAS.includes(String(n));
    if (b.accion === "eliminar") {
      await db.execute({ sql: `DELETE FROM prestamos_internos_plan WHERE id = ?`, args: [Number(b.id)] });
      return NextResponse.json({ ok: true });
    }
    if (!valida(b.prestamista) || !valida(b.deudora) || b.prestamista === b.deudora) return NextResponse.json({ error: "Elige la oficina que presta y la que recibe (distintas)." }, { status: 400 });
    if (b.accion === "abono") {
      // Primero se valida; el reemplazo (borrar el abono anterior y escribir el nuevo) va en un solo lote.
      const quitar = b.abono === null || b.abono === undefined || b.abono === "";
      const v = quitar ? 0 : Number(b.abono);
      if (!quitar && !(Number.isFinite(v) && v >= 0)) return NextResponse.json({ error: "El abono debe ser un número igual o mayor a 0." }, { status: 400 });
      const borrar = { sql: `DELETE FROM prestamos_internos_plan WHERE ejercicio = ? AND tipo = 'abono' AND prestamista = ? AND deudora = ?`, args: [ejercicio, b.prestamista, b.deudora] };
      await db.batch(quitar ? [borrar] : [borrar,
        { sql: `INSERT INTO prestamos_internos_plan (ejercicio, tipo, prestamista, deudora, monto, actualizado_en) VALUES (?, 'abono', ?, ?, ?, datetime('now'))`, args: [ejercicio, b.prestamista, b.deudora, v] }], "write");
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "nuevo") {
      const mes = Number(b.mes), monto = Number(b.monto);
      if (!(mes >= 1 && mes <= 12) || !(monto > 0)) return NextResponse.json({ error: "Falta el mes y un monto mayor a 0." }, { status: 400 });
      const args = [b.prestamista, b.deudora, mes, monto, String(b.descripcion ?? "").trim()];
      if (b.id) await db.execute({ sql: `UPDATE prestamos_internos_plan SET prestamista = ?, deudora = ?, mes = ?, monto = ?, descripcion = ?, actualizado_en = datetime('now') WHERE id = ?`, args: [...args, Number(b.id)] });
      else await db.execute({ sql: `INSERT INTO prestamos_internos_plan (ejercicio, tipo, prestamista, deudora, mes, monto, descripcion, actualizado_en) VALUES (?, 'nuevo', ?, ?, ?, ?, ?, datetime('now'))`, args: [ejercicio, ...args] });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando" }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
export const maxDuration = 60;
