import { NextResponse, NextRequest } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { calcularTotalesNomina, calcularLineasProvisionMensuales, extrasNominaPorMes, type Empleado } from "../../../lib/calc/th1";
import { leerParametrosInstitucionales } from "../../../lib/parametros-institucionales";
import type { ParametrosVigentes } from "../../../lib/calc/parametros-vigentes";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";


async function resolverAgenciaId(db: ReturnType<typeof getDb>, agenciaNombre: string | null): Promise<number> {
  if (!agenciaNombre || agenciaNombre === "Matriz") {
    return getOrCreateMatrizId(db);
  }
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [agenciaNombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${agenciaNombre}" no existe`);
  return res.rows[0].id as number;
}

function extraerCuentaPorMes(filas: { concepto: string; mes: number; monto: number }[], codigo: string): number[] {
  const porMes = Array(12).fill(0);
  for (const f of filas) {
    if (f.concepto.replace(/\D/g, "") === codigo && f.mes >= 1 && f.mes <= 12) porMes[f.mes - 1] += f.monto;
  }
  return porMes;
}

/**
 * Resumen de la cuenta 4501 (Gastos de Personal): descompone el total en sus
 * 5 rubros -- Sueldo, Décimo Tercero, Décimo Cuarto, IESS Patronal y Fondo de
 * Reserva (Nómina, combinados con las 4 cuentas variables de Talento Humano
 * cuando aplica) -- más "Otros" (el resto de cuentas 4501 directas de
 * Talento Humano que no entran en esas fórmulas).
 */
async function leerGETAgencia(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia");
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);
    const ejercicio = await ejercicioDe(req);

    const [empleadosRes, cuentasRes] = await Promise.all([
      db.execute({
        sql: `SELECT nombre, basico_2025, incremento_pct, movilizacion_anual
              FROM nomina_empleados WHERE agencia_id = ? AND activo = 1`,
        args: [agenciaId],
      }),
      db.execute({
        sql: `SELECT concepto, mes, monto FROM presupuesto_departamental
              WHERE agencia_id = ? AND ejercicio = ? AND concepto LIKE '4501%'`,
        args: [agenciaId, ejercicio],
      }),
    ]);

    const empleados: Empleado[] = empleadosRes.rows.map((r) => ({
      nombre: r.nombre as string,
      basico2025: r.basico_2025 as number,
      incrementoPct: r.incremento_pct as number,
      movilizacionAnual: r.movilizacion_anual as number,
    }));
    const vigentes = Object.fromEntries(Object.entries(await leerParametrosInstitucionales(ejercicio)).map(([k, v]) => [k, v.valor])) as unknown as ParametrosVigentes;
    const totales = calcularTotalesNomina(empleados, vigentes);

    const filas = cuentasRes.rows.map((r) => ({
      concepto: r.concepto as string,
      mes: r.mes as number,
      monto: r.monto as number,
    }));

    const horasExtrasPorMes = extraerCuentaPorMes(filas, "45019005");
    const comisionesPorMes = extraerCuentaPorMes(filas, "45019010");
    const otrosGastosPersonalPorMes = extraerCuentaPorMes(filas, "45019090");
    const subrogacionesPorMes = extraerCuentaPorMes(filas, "45019095");

    const lineas = calcularLineasProvisionMensuales(totales, {
      horasExtrasPorMes,
      comisionesPorMes,
      otrosGastosPersonalPorMes,
      subrogacionesPorMes,
    }, vigentes);

    // "Otros" = todo lo de Talento Humano tal cual (todas las cuentas 4501
    // directas), sin restar nada -- porque las 4 cuentas de arriba SÍ se
    // pagan directo (aparecen aquí) ADEMÁS de generar la provisión de
    // Décimo/Fondo Reserva/IESS que se muestra en las líneas de Nómina.
    const otrosPorMes = Array(12).fill(0);
    for (const f of filas) {
      if (f.mes >= 1 && f.mes <= 12) otrosPorMes[f.mes - 1] += f.monto;
    }

    const totalPorMes = Array.from(
      { length: 12 },
      (_, i) =>
        lineas.sueldoPorMes[i] +
        lineas.decimoTerceroPorMes[i] +
        lineas.decimoCuartoPorMes[i] +
        lineas.iessPatronalPorMes[i] +
        lineas.fondoReservaPorMes[i] +
        otrosPorMes[i]
    );

    // Parte de los valores variables de Talento Humano (horas extras, comisiones, subrogaciones) dentro de
    // Décimo tercero, Fondo de reserva e IESS: la misma función del motor (th1.ts)
    const x = extrasNominaPorMes({ horasExtrasPorMes, comisionesPorMes, otrosGastosPersonalPorMes, subrogacionesPorMes }, vigentes);

    return NextResponse.json({
      rubros: [
        { nombre: "Sueldo mensual (Nómina)", montosPorMes: lineas.sueldoPorMes },
        { nombre: "Décimo Tercero", montosPorMes: lineas.decimoTerceroPorMes },
        { nombre: "Décimo Cuarto (Nómina)", montosPorMes: lineas.decimoCuartoPorMes },
        { nombre: "IESS Patronal", montosPorMes: lineas.iessPatronalPorMes },
        { nombre: "Fondo de Reserva", montosPorMes: lineas.fondoReservaPorMes },
        { nombre: "Otros (Talento Humano, directo)", montosPorMes: otrosPorMes },
      ],
      totalPorMes,
      numeroEmpleados: totales.numeroEmpleados,
      extras: { decimoPorMes: x.decimoTercero, fondoPorMes: x.fondoReserva, iessPorMes: x.iessPatronal, basePorMes: x.base },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el resumen de 4501" }, { status: 500 });
  }
}

// Consolidado = suma de las 10 agencias (lib/consolidado.ts)
export const GET = conConsolidado(leerGETAgencia);
export const maxDuration = 60;
