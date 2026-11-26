import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { baseHistorica } from "../../../lib/base-historica";

/**
 * GET ?grupo=45&agencia=Matriz&ejercicio=2027 → { cuentas } con la base sugerida de cada cuenta (últimos 12 meses
 * cargados antes del ejercicio), los pesos estacionales y la comparación de los dos años anteriores. Se calcula de
 * los Históricos (lib/base-historica.ts). Alimenta «Cargar histórico» y «Recalcular» en Ingresos y Gastos.
 * Solo lectura: no toca lo cargado en las hojas.
 */
async function leerGET(req: NextRequest) {
  try {
    const grupo = req.nextUrl.searchParams.get("grupo");
    const agencia = req.nextUrl.searchParams.get("agencia");
    if (!grupo || !agencia || !/^\d+$/.test(grupo)) {
      return NextResponse.json({ error: "Faltan parámetros: grupo y agencia son obligatorios" }, { status: 400 });
    }
    const ejercicio = await ejercicioDe(req);
    const cuentas = await baseHistorica(getDb(), ejercicio, grupo, [agencia]);
    return NextResponse.json({ cuentas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo la base histórica" }, { status: 500 });
  }
}

export const GET = conCacheGET("base-historica-gastos", leerGET);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
