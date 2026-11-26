import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId, resolverCorteSaldos } from "../../../lib/insumos-agencia";
import { conCacheGET } from "../../../lib/cache-motor";
import { asegurarTablaDiferidos, leerDiferidos, leerReparto, porcentajesActivoCorte, planMaterialesAgencia, GASTO_POR_DEFECTO } from "../../../lib/activos-diferidos";
import { proyectarDiferidos, agregarPlanMateriales, GRUPOS_DIFERIDOS, CONCEPTO_ANTICIPOS, CONCEPTO_MAT_COMPRAS, CONCEPTO_MAT_CONSUMO, type GrupoDiferido } from "../../../lib/calc/activos-diferidos";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * Gastos anticipados (1904), gastos diferidos (1905) y materiales (1906): registro y proyección.
 * GET ?agencia=Matriz&ejercicio=2027 → corte, proyeccion (grupos y partidas con la parte de la agencia), cuentas del catálogo.
 * POST { accion: "guardar", agencia, partida }  → crea o actualiza (id opcional). Alcance "cooperativa" = toda la cooperativa.
 * POST { accion: "eliminar", id }
 * GET ?vista=cargados → partidas de la 1905 cargadas desde el reporte, por agencia
 * POST { accion: "importar", grupo: "1905", filas } → reporte de amortización de contabilidad (ver lib/calc/diferidos-archivo.ts)
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    // Carga de datos → Activos diferidos: lo cargado desde el reporte de contabilidad, por agencia
    if (req.nextUrl.searchParams.get("vista") === "cargados") {
      const r = await db.execute(`SELECT a.nombre AS agencia, COUNT(*) AS partidas, SUM(d.monto) AS monto, MAX(d.actualizado_en) AS actualizado
        FROM activos_diferidos d JOIN agencias a ON a.id = d.agencia_id WHERE d.grupo = '1905' AND d.origen = 'archivo' GROUP BY a.nombre`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      return NextResponse.json({ cargados: r.rows.map((x) => ({ agencia: String(x.agencia), partidas: Number(x.partidas), monto: Number(x.monto) || 0, actualizado: String(x.actualizado ?? "") })) });
    }
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const agenciaId = await resolverAgenciaId(db, agencia);
    const corte = await resolverCorteSaldos(db, agenciaId);
    const fechaCorte = new Date(Date.UTC(corte.anio, corte.mes, 0)).toISOString().slice(0, 10);
    const [partidas, sal, cat, par] = await Promise.all([
      leerDiferidos(db, agenciaId, agencia),
      db.execute({ sql: `SELECT cuenta_codigo, monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ? AND (cuenta_codigo LIKE '1904%' OR cuenta_codigo LIKE '1905%' OR cuenta_codigo LIKE '1906%') AND LENGTH(cuenta_codigo) <= 6`, args: [agenciaId, corte.anio, corte.mes] }),
      db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE (codigo LIKE '1904%' OR codigo LIKE '1905%' OR codigo LIKE '1906%' OR codigo LIKE '4503%' OR codigo LIKE '4506%' OR codigo LIKE '4507%') AND length(codigo) >= 6 ORDER BY codigo`).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      db.execute({ sql: `SELECT concepto, mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto IN (?, ?, ?)`, args: [agenciaId, ejercicio, CONCEPTO_ANTICIPOS, CONCEPTO_MAT_COMPRAS, CONCEPTO_MAT_CONSUMO] }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);
    // saldos del grupo y de sus subcuentas (para cuadrar las partidas con la subcuenta donde se registran, p. ej. 190490)
    const saldosSub = Object.fromEntries(sal.rows.map((r) => [String(r.cuenta_codigo), Math.abs(Number(r.monto) || 0)])) as Record<string, number>;
    const saldosCorte = Object.fromEntries(GRUPOS_DIFERIDOS.map((g) => [g, saldosSub[g] ?? 0])) as Partial<Record<GrupoDiferido, number>>;
    const variacion = Array.from({ length: 12 }, (_, m) => Number(par.rows.find((r) => String(r.concepto) === CONCEPTO_ANTICIPOS && Number(r.mes) === m + 1)?.monto ?? 0) || 0);
    const conSub = Object.keys(saldosSub).some((k) => k.length === 6 && k.startsWith("1904"));
    const proyeccion = proyectarDiferidos(partidas, ejercicio, fechaCorte, saldosCorte, {}, { saldoCorte: conSub ? saldosSub["190410"] ?? 0 : null, variacionPorMes: variacion });
    // 1906: plan mensual de compras y consumo (por defecto, el promedio histórico de la agencia)
    agregarPlanMateriales(proyeccion, await planMaterialesAgencia(db, agencia, ejercicio, par.rows.map((r) => ({ concepto: String(r.concepto), mes: Number(r.mes), monto: Number(r.monto) })), saldosCorte["1906"] ?? 0));
    return NextResponse.json({
      corte, fechaCorte, ejercicio, saldosSub,
      proyeccion: { ...proyeccion, partidas: proyeccion.partidas.map((p) => ({ ...p, agencia: p.alcance === "cooperativa" ? "Toda la cooperativa" : p.alcance === "reparto" ? "Varias agencias" : agencia })) },
      cuentas: cat.rows.map((r) => ({ codigo: String(r.codigo), nombre: String(r.nombre) })),
      gastoPorDefecto: GASTO_POR_DEFECTO,
      porcentajesActivo: await porcentajesActivoCorte(db).catch(() => []),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los gastos anticipados y diferidos" }, { status: 500 });
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    await asegurarTablaDiferidos(db);
    if (body.accion === "eliminar") {
      await db.execute({ sql: `DELETE FROM activos_diferidos WHERE id = ?`, args: [Number(body.id)] });
      return NextResponse.json({ ok: true });
    }
    // Reporte de amortización de contabilidad (1905): reemplaza las partidas cargadas antes de las agencias que trae el
    // archivo; las registradas a mano se mantienen. Lo editado en la herramienta (nombre corto, renovación, incremento,
    // forma de pago) se conserva en las partidas que vuelven a venir (misma agencia, fecha, monto y descripción).
    if (body.accion === "importar") {
      const grupo = String(body.grupo ?? "1905") as GrupoDiferido;
      const filas = Array.isArray(body.filas) ? body.filas as Record<string, unknown>[] : [];
      if (grupo !== "1905" || !filas.length) return NextResponse.json({ error: "El archivo no trae partidas de gastos diferidos." }, { status: 400 });
      const ids = new Map<string, number>();
      for (const n of [...new Set(filas.map((f) => String(f.agencia)))]) ids.set(n, await resolverAgenciaId(db, n));
      const malas = filas.filter((f) => !FECHA.test(String(f.fechaInicio)) || !FECHA.test(String(f.fechaFin)) || !(Number(f.monto) > 0) || !String(f.cuentaGasto ?? "").startsWith("45"));
      if (malas.length) return NextResponse.json({ error: `${malas.length} filas sin fecha, monto o cuenta válidos.` }, { status: 400 });
      const lista = [...ids.values()];
      const previas = await db.execute({ sql: `SELECT * FROM activos_diferidos WHERE grupo = ? AND origen = 'archivo' AND agencia_id IN (${lista.map(() => "?").join(",")})`, args: [grupo, ...lista] });
      const clave = (ag: unknown, ini: unknown, monto: unknown, det: unknown) => `${ag}|${ini}|${Math.round(Number(monto) * 100)}|${String(det).trim().toLowerCase()}`;
      const antes = new Map(previas.rows.map((r) => [clave(r.agencia_id, r.fecha_inicio, r.monto, r.detalle), r]));
      const stmts = [
        { sql: `DELETE FROM activos_diferidos WHERE grupo = ? AND origen = 'archivo' AND agencia_id IN (${lista.map(() => "?").join(",")})`, args: [grupo, ...lista] },
        ...filas.map((f) => {
          const ag = ids.get(String(f.agencia))!;
          const det = String(f.detalle ?? f.descripcion ?? "").trim();
          const prev = antes.get(clave(ag, f.fechaInicio, f.monto, det));
          return {
            sql: `INSERT INTO activos_diferidos (grupo, descripcion, proveedor, cuenta_activo, cuenta_gasto, fecha_inicio, fecha_fin, monto, alcance, agencia_id, renueva, incremento_pct, pct_base, cuotas_pago, meses_pago, detalle, origen, actualizado_en)
                  VALUES (?, ?, '', ?, ?, ?, ?, ?, 'agencia', ?, ?, ?, 'corte', ?, ?, ?, 'archivo', datetime('now'))`,
            args: [grupo, prev ? String(prev.descripcion) : String(f.descripcion ?? det).slice(0, 120), String(f.cuentaActivo ?? ""), String(f.cuentaGasto), String(f.fechaInicio), String(f.fechaFin),
              Number(f.monto), ag, prev ? Number(prev.renueva) : f.renueva ? 1 : 0, prev ? Number(prev.incremento_pct) || 0 : 0,
              prev ? Number(prev.cuotas_pago) || 1 : 1, prev ? String(prev.meses_pago ?? "") : "", det],
          };
        }),
      ];
      // Un solo lote: el borrado de lo anterior y las partidas nuevas se aplican juntos o no se aplican.
      await db.batch(stmts, "write");
      return NextResponse.json({ ok: true, partidas: filas.length, agencias: lista.length, conservadas: filas.filter((f) => antes.has(clave(ids.get(String(f.agencia)), f.fechaInicio, f.monto, String(f.detalle ?? f.descripcion ?? "").trim()))).length });
    }
    if (body.accion === "guardar") {
      const p = body.partida ?? {};
      const grupo = String(p.grupo) as GrupoDiferido;
      const coop = p.alcance === "cooperativa";
      const rep = p.alcance === "reparto";
      const reparto = rep ? leerReparto(p.reparto) : {};
      const errores: string[] = [];
      if (rep && !Object.keys(reparto).length) errores.push("la cantidad de al menos una agencia");
      if (!GRUPOS_DIFERIDOS.includes(grupo)) errores.push("el grupo (1904, 1905 o 1906)");
      if (!String(p.descripcion ?? "").trim()) errores.push("la descripción");
      if (!FECHA.test(String(p.fechaInicio)) || !FECHA.test(String(p.fechaFin)) || String(p.fechaFin) < String(p.fechaInicio)) errores.push("fechas válidas (fin igual o después del inicio)");
      if (!(Number(p.monto) > 0)) errores.push("un monto mayor a 0");
      if (!String(p.cuentaGasto ?? "").startsWith("45")) errores.push("la cuenta de gasto (grupo 45)");
      const inc = Number(p.incremento ?? 0);
      // meses en que se paga (1–12); uno solo = ese mes; ninguno = de contado
      const meses = [...new Set((Array.isArray(p.mesesPago) ? p.mesesPago : []).map((x: unknown) => Math.round(Number(x))).filter((x: number) => x >= 1 && x <= 12))].sort((x, y) => (x as number) - (y as number)) as number[];
      const cuotas = Math.max(1, meses.length);
      if (!(inc >= -50 && inc <= 100)) errores.push("un incremento entre −50 % y 100 %");
      if (!coop && !rep && (!body.agencia || body.agencia === "Consolidado")) errores.push("una agencia (o el alcance «Toda la cooperativa»)");
      if (errores.length) return NextResponse.json({ error: `Falta ${errores.join(", ")}.` }, { status: 400 });
      const agenciaId = coop || rep ? null : await resolverAgenciaId(db, body.agencia);
      const args = [grupo, String(p.descripcion).trim(), String(p.proveedor ?? "").trim(), String(p.cuentaActivo ?? ""), String(p.cuentaGasto),
        String(p.fechaInicio), String(p.fechaFin), Number(p.monto), coop ? "cooperativa" : rep ? "reparto" : "agencia", agenciaId, p.renueva ? 1 : 0, inc,
        coop && p.pctBase === "anterior" ? "anterior" : "corte", cuotas, meses.join(","), String(p.detalle ?? "").trim(), rep ? JSON.stringify(reparto) : "", grupo === "1906" && p.movimiento === "gasto" ? "gasto" : "pedido"];
      if (p.id) {
        await db.execute({
          sql: `UPDATE activos_diferidos SET grupo = ?, descripcion = ?, proveedor = ?, cuenta_activo = ?, cuenta_gasto = ?, fecha_inicio = ?, fecha_fin = ?,
                monto = ?, alcance = ?, agencia_id = ?, renueva = ?, incremento_pct = ?, pct_base = ?, cuotas_pago = ?, meses_pago = ?, detalle = ?, reparto = ?, movimiento = ?, actualizado_en = datetime('now') WHERE id = ?`,
          args: [...args, Number(p.id)],
        });
      } else {
        await db.execute({
          sql: `INSERT INTO activos_diferidos (grupo, descripcion, proveedor, cuenta_activo, cuenta_gasto, fecha_inicio, fecha_fin, monto, alcance, agencia_id, renueva, incremento_pct, pct_base, cuotas_pago, meses_pago, detalle, reparto, movimiento, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          args,
        });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando la partida" }, { status: 500 });
  }
}

// Consolidado: suma de las agencias. Las partidas de toda la cooperativa se suman por agencia (cada una su parte);
// el monto, los días y el incremento de la partida son los mismos en todas: se toman de la primera.
export const GET = conConsolidado(conCacheGET("activos-diferidos", leerGET), (suma, partes) => {
  const orig = new Map<number, Record<string, unknown>>();
  for (const p of partes) for (const x of ((p.proyeccion as { partidas?: Record<string, unknown>[] })?.partidas ?? [])) if (!orig.has(Number(x.id))) orig.set(Number(x.id), x);
  const proy = suma.proyeccion as { partidas?: Record<string, unknown>[] } | undefined;
  if (proy?.partidas) proy.partidas = proy.partidas.map((x) => {
    const o = orig.get(Number(x.id));
    return o ? { ...x, monto: o.monto, reparto: o.reparto, dias: o.dias, meses: o.meses, cuotasPago: o.cuotasPago, mesesPago: o.mesesPago, incremento: o.incremento, renovacionesEnAnio: o.renovacionesEnAnio, ejercicio: o.ejercicio } : x;
  });
  return { ...suma, ejercicio: (partes[0] as { ejercicio?: number }).ejercicio, corte: (partes[0] as { corte?: unknown }).corte, fechaCorte: (partes[0] as { fechaCorte?: unknown }).fechaCorte, gastoPorDefecto: (partes[0] as { gastoPorDefecto?: unknown }).gastoPorDefecto, cuentas: (partes[0] as { cuentas?: unknown }).cuentas, porcentajesActivo: (partes[0] as { porcentajesActivo?: unknown }).porcentajesActivo };
});
