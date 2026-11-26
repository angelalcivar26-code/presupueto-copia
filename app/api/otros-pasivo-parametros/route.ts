import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, meses, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { ejercicioDe, ejercicioPorDefecto } from "../../../lib/ejercicio-pedido";


const CONCEPTOS_OTROS_PASIVO = [
  "gastos_anticipados_entradas",
  "gastos_anticipados_salidas",
  "materiales_entradas",
  "materiales_compras_mes",
  "materiales_consumo_mes",
  "materiales_salidas",
  "transferencias_1908_entradas",
  "transferencias_1908_salidas",
  "cuentas_por_pagar_incrementos",
  "cuentas_por_pagar_pagos",
  "transferencias_2908_incrementos",
  "transferencias_2908_disminuciones",
  "fondo_liquidez_pct_vigente",
  "cuentas_por_cobrar_variacion",
  "aportes_socios_nuevos",
  "retiros_aporte_socios",
  "capital_social_monto_aporte",
  "capital_social_socios_nuevos",
  "capital_social_socios_retirados",
  "capital_social_capitalizacion_dividendos",
  "capital_social_socios_inicial",
  "capital_social_devolucion_promedio", // lo que se devuelve en promedio a cada socio que se retira
  "patrimonio_donaciones_efectivo", // 34: donaciones / aportes no reembolsables en efectivo (entran al Flujo)
  "patrimonio_revaluo_terrenos",    // 35: revalúo de terrenos (sube 1801, sin efectivo)
  "patrimonio_revaluo_edificios",   // 35: revalúo de edificios (sube 1802, se deprecia, sin efectivo)
  "ingresos_tasa_bancos",             // 5101: % anual que pagan los bancos sobre el saldo de 1103 (por defecto 0,35 %)
  "ingresos_tasa_prestamos_internos", // 5190: % anual de los préstamos internos de 1908 (por defecto 7,03 %)
  "colocacion_pct_cumplimiento",      // Cartera: % de la meta de los asesores que se presupuesta colocar (por defecto 100 %)
  "cosede_prima_fija_anual",          // 4504 · COSEDE prima fija anual (fracción); sin dato = tasa real del histórico
  "cosede_par_anual",                 // 4504 · COSEDE prima ajustada por riesgo anual (fracción)
  "seps_tasa_activos_semestral",      // 4504 · SEPS 0,45 por mil semestral sobre activos promedio
  "seps_tasa_excedentes",             // 4504 · SEPS 1 % sobre excedentes del año anterior
  "anticipos_terceros_variacion",     // 190410 · variación mensual de los anticipos a terceros (+ sube, − baja)
  "fondo_liquidez_tasa_rendimiento",  // 1902 / 53040505 · rendimiento anual del fideicomiso de liquidez (fracción)
  "provision_factor_mora",            // Provisión: multiplica la entrada a la mora de la agencia (1 − meta de mejora del ritmo de atraso)
] as const;

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

/** GET ?agencia=Matriz&ejercicio=2027 -> { parametros: { [concepto]: number[12] } } */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    // Consolidado (solo lectura): montos sumados de las 10 agencias; los % y tasas no se suman (quedan en 0)
    const consolidado = agenciaNombre === "Consolidado";
    const res = consolidado
      ? await db.execute({
          sql: `SELECT concepto, mes, SUM(monto) AS monto FROM otros_pasivo_parametros
                WHERE ejercicio = ? AND concepto NOT LIKE '%pct%' AND concepto NOT LIKE '%tasa%' GROUP BY concepto, mes`,
          args: [ejercicio],
        })
      : await db.execute({
          sql: `SELECT concepto, mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ?`,
          args: [await resolverAgenciaId(db, agenciaNombre), ejercicio],
        });

    const parametros: Record<string, number[]> = {};
    for (const concepto of CONCEPTOS_OTROS_PASIVO) parametros[concepto] = Array(12).fill(0);
    for (const row of res.rows) {
      const concepto = row.concepto as string;
      const mes = row.mes as number;
      if (parametros[concepto] && mes >= 1 && mes <= 12) parametros[concepto][mes - 1] = row.monto as number;
    }

    return NextResponse.json({ parametros, tieneDatos: res.rows.length > 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo los parámetros de Otros Activos y Pasivo" }, { status: 500 });
  }
}

/** POST { agencia, ejercicio, concepto, montosPorMes: number[12] } -> guarda/actualiza los 12 meses de un concepto (en una sola transacción) */
export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { agencia, ejercicio, concepto, montosPorMes, todasLasAgencias, borrar } = body;
    // { borrar: true }: quita el parámetro guardado (vuelve al valor por defecto: real del histórico o de la norma)
    if (borrar && CONCEPTOS_OTROS_PASIVO.includes(concepto)) {
      const ejercicioB = Number(ejercicio ?? (await ejercicioPorDefecto()));
      if (todasLasAgencias) await db.execute({ sql: `DELETE FROM otros_pasivo_parametros WHERE ejercicio = ? AND concepto = ?`, args: [ejercicioB, concepto] });
      else await db.execute({ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = ?`, args: [await resolverAgenciaId(db, agenciaParaGuardar(agencia)), ejercicioB, concepto] });
      return NextResponse.json({ borrado: true });
    }

    if (!concepto || !Array.isArray(montosPorMes) || montosPorMes.length !== 12) {
      return NextResponse.json({ error: "Faltan campos: concepto y montosPorMes (12 valores)" }, { status: 400 });
    }
    if (!CONCEPTOS_OTROS_PASIVO.includes(concepto)) {
      return NextResponse.json({ error: `Concepto "${concepto}" no reconocido` }, { status: 400 });
    }

    const valores = meses(montosPorMes, `Parámetro ${concepto}`) as number[];
    const ejercicioFinal = Number(ejercicio ?? (await ejercicioPorDefecto()));
    // "Aplicar a todas las agencias" (solo para el % de cumplimiento de la colocación): los mismos 12 meses en las 10 agencias
    const ids = todasLasAgencias && (concepto === "colocacion_pct_cumplimiento" || concepto === "ingresos_tasa_prestamos_internos" || /^(cosede|seps)_/.test(concepto))
      ? (await db.execute(`SELECT id FROM agencias`)).rows.map((r) => Number(r.id))
      : [await resolverAgenciaId(db, agenciaParaGuardar(agencia))];

    await db.batch(
      ids.flatMap((agenciaId) => Array.from({ length: 12 }, (_, i) => ({
        sql: `INSERT INTO otros_pasivo_parametros (agencia_id, ejercicio, concepto, mes, monto)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(agencia_id, ejercicio, concepto, mes) DO UPDATE SET monto = excluded.monto`,
        args: [agenciaId, ejercicioFinal, concepto, i + 1, valores[i]],
      }))),
      "write"
    );

    return NextResponse.json({ guardado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el parámetro" }, { status: 500 });
  }
}
