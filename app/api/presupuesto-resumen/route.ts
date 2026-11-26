import { NextRequest, NextResponse } from "next/server";
import { meses, monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { calcularActivosYPorcentajesAgencias } from "../../../lib/prorrateo";
import { ejercicioDe, ejercicioPorDefecto } from "../../../lib/ejercicio-pedido";


async function leerGETAgencia(req: NextRequest) {
  try {
    const db = getDb();
    const departamento = req.nextUrl.searchParams.get("departamento");
    const ejercicio = await ejercicioDe(req);

    const sql = departamento
      ? `SELECT id, departamento, nombre, mes, monto, nota FROM presupuesto_resumen WHERE departamento = ? AND ejercicio = ? ORDER BY nombre, mes`
      : `SELECT id, departamento, nombre, mes, monto, nota FROM presupuesto_resumen WHERE ejercicio = ? ORDER BY departamento, nombre, mes`;
    const args = departamento ? [departamento, ejercicio] : [ejercicio];

    const res = await db.execute({ sql, args });
    return NextResponse.json({ filas: res.rows });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo Valores institucionales" }, { status: 500 });
  }
}

/**
 * Crea una línea nueva de Valores institucionales para los 12 meses de una
 * sola vez, dentro de un ejercicio. La nota (opcional) documenta de dónde
 * sale el monto (ej. "2 pagos: abril y junio, contrato anual") -- texto
 * libre, no se recalcula.
 */
export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { departamento, nombre, montosPorMes, nota, ejercicio } = body;
    const ejercicioFinal = ejercicio ?? (await ejercicioPorDefecto());

    if (!departamento || !nombre || !Array.isArray(montosPorMes) || montosPorMes.length !== 12) {
      return NextResponse.json(
        { error: "Faltan campos: departamento, nombre y montosPorMes (array de 12 valores) son obligatorios" },
        { status: 400 }
      );
    }

    // Los 12 meses se validan primero y se graban en un solo lote: o quedan los 12 o ninguno
    const valores = meses(montosPorMes, `Línea ${nombre}`);
    const res = await db.batch(valores.map((v, i) => ({
      sql: `INSERT INTO presupuesto_resumen (departamento, nombre, mes, monto, nota, ejercicio) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [departamento, nombre, i + 1, v ?? 0, nota ?? null, ejercicioFinal],
    })), "write");
    const ids = res.map((r) => Number(r.lastInsertRowid));

    return NextResponse.json({ ids });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el registro" }, { status: 500 });
  }
}

/**
 * Dos usos:
 * - { id, monto }: actualiza el monto institucional de un mes puntual y
 *   propaga el cambio a las 10 agencias en presupuesto_departamental
 *   (recalcula cada una por su % de Activo). No necesita ejercicio: el id
 *   ya identifica una fila de un ejercicio específico sin ambigüedad.
 * - { cambios: [{ id, monto }, ...] }: varios meses en una sola llamada (un solo lote).
 * - { accion: "actualizar_nota", departamento, nombre, nota, ejercicio }:
 *   actualiza solo la nota de origen de toda la línea (las 12 filas), sin
 *   tocar montos.
 */
export async function PATCH(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();

    if (body.accion === "actualizar_nota") {
      const { departamento, nombre, nota, ejercicio } = body;
      const ejercicioFinal = ejercicio ?? (await ejercicioPorDefecto());
      if (!departamento || !nombre) {
        return NextResponse.json({ error: "Faltan campos: departamento, nombre" }, { status: 400 });
      }
      await db.execute({
        sql: `UPDATE presupuesto_resumen SET nota = ? WHERE departamento = ? AND nombre = ? AND ejercicio = ?`,
        args: [nota ?? null, departamento, nombre, ejercicioFinal],
      });
      return NextResponse.json({ actualizado: true });
    }

    // { cambios: [{ id, monto }, ...] }: los 12 meses en una sola llamada. Se calcula el % de Activo
    // una sola vez y todo se graba en un solo lote (antes eran 12 llamadas, cada una releyendo los saldos).
    if (Array.isArray(body.cambios)) {
      const cambios = (body.cambios as { id: number; monto: number }[]).filter((c) => c && c.id && c.monto !== undefined);
      if (!cambios.length) return NextResponse.json({ actualizado: true, dependientesActualizados: 0 });
      const ids = cambios.map((c) => c.id);
      const dependientes = await db.execute({
        sql: `SELECT pd.id AS pd_id, pd.resumen_id, a.nombre AS agencia_nombre
              FROM presupuesto_departamental pd JOIN agencias a ON a.id = pd.agencia_id
              WHERE pd.resumen_id IN (${ids.map(() => "?").join(",")}) AND pd.modo = 'prorrateado'`,
        args: ids,
      });
      const valores = cambios.map((c) => validarMonto(c.monto, "Monto"));
      const montoDe = new Map(cambios.map((c, i) => [Number(c.id), valores[i]]));
      const lote: { sql: string; args: (number | string)[] }[] = cambios.map((c, i) => ({ sql: `UPDATE presupuesto_resumen SET monto = ? WHERE id = ?`, args: [valores[i], c.id] }));
      if (dependientes.rows.length) {
        const { porcentajes } = await calcularActivosYPorcentajesAgencias(db);
        for (const r of dependientes.rows) {
          lote.push({ sql: `UPDATE presupuesto_departamental SET monto = ? WHERE id = ?`,
                      args: [(montoDe.get(Number(r.resumen_id)) ?? 0) * (porcentajes[r.agencia_nombre as string] ?? 0), r.pd_id as number] });
        }
      }
      await db.batch(lote, "write");
      return NextResponse.json({ actualizado: true, dependientesActualizados: dependientes.rows.length });
    }

    const { id, monto } = body;
    if (!id || monto === undefined) {
      return NextResponse.json({ error: "Faltan campos: id, monto" }, { status: 400 });
    }

    const montoValido = validarMonto(monto, "Monto");
    await db.execute({ sql: `UPDATE presupuesto_resumen SET monto = ? WHERE id = ?`, args: [montoValido, id] });

    const dependientes = await db.execute({
      sql: `SELECT pd.id AS pd_id, a.nombre AS agencia_nombre
            FROM presupuesto_departamental pd
            JOIN agencias a ON a.id = pd.agencia_id
            WHERE pd.resumen_id = ? AND pd.modo = 'prorrateado'`,
      args: [id],
    });

    let dependientesActualizados = 0;
    if (dependientes.rows.length > 0) {
      const { porcentajes } = await calcularActivosYPorcentajesAgencias(db);
      await db.batch(dependientes.rows.map((row) => ({
        sql: `UPDATE presupuesto_departamental SET monto = ? WHERE id = ?`,
        args: [montoValido * (porcentajes[row.agencia_nombre as string] ?? 0), row.pd_id as number],
      })), "write");
      dependientesActualizados = dependientes.rows.length;
    }

    return NextResponse.json({ actualizado: true, dependientesActualizados });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error actualizando el registro" }, { status: 500 });
  }
}

/** Elimina una línea completa (los 12 meses) por nombre+departamento+ejercicio, o un solo id si se pasa idUnico. */
export async function DELETE(req: NextRequest) {
  try {
    const db = getDb();
    const departamento = req.nextUrl.searchParams.get("departamento");
    const nombre = req.nextUrl.searchParams.get("nombre");
    const idUnico = req.nextUrl.searchParams.get("id");
    const ejercicio = await ejercicioDe(req);

    // Junto con la línea se borran, en el mismo lote, las filas prorrateadas de las agencias que salían de ella:
    // antes quedaban sueltas con su último monto y seguían sumando en el Estado de resultados.
    if (idUnico) {
      await db.batch([
        { sql: `DELETE FROM presupuesto_departamental WHERE resumen_id = ? AND modo = 'prorrateado'`, args: [idUnico] },
        { sql: `DELETE FROM presupuesto_resumen WHERE id = ?`, args: [idUnico] },
      ], "write");
    } else if (departamento && nombre) {
      await db.batch([
        {
          sql: `DELETE FROM presupuesto_departamental WHERE modo = 'prorrateado' AND resumen_id IN (
                  SELECT id FROM presupuesto_resumen WHERE departamento = ? AND nombre = ? AND ejercicio = ?)`,
          args: [departamento, nombre, ejercicio],
        },
        { sql: `DELETE FROM presupuesto_resumen WHERE departamento = ? AND nombre = ? AND ejercicio = ?`, args: [departamento, nombre, ejercicio] },
      ], "write");
    } else {
      return NextResponse.json({ error: "Falta id, o departamento+nombre" }, { status: 400 });
    }

    return NextResponse.json({ eliminado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error eliminando el registro" }, { status: 500 });
  }
}

// Consolidado = suma de las 10 agencias (lib/consolidado.ts)
export const GET = conConsolidado(leerGETAgencia);
export const maxDuration = 60;
