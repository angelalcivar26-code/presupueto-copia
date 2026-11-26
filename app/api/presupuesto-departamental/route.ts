import { NextRequest, NextResponse } from "next/server";
import { baseHistorica } from "../../../lib/base-historica";
import { agenciaParaGuardar, meses, monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { calcularActivosYPorcentajesAgencias } from "../../../lib/prorrateo";
import { cuentaCalculada } from "../../../lib/calc/orquestador";
import { calcularMontosMensuales } from "../../../lib/montos-historico";
import { completarHistorico } from "../../../lib/completar-historico";
import { ejercicioDe, ejercicioPorDefecto } from "../../../lib/ejercicio-pedido";

type Db = ReturnType<typeof getDb>;
type Modo = "directo" | "prorrateado";


async function resolverAgenciaId(db: Db, agenciaNombre: string | null): Promise<number> {
  if (!agenciaNombre || agenciaNombre === "Matriz") {
    return getOrCreateMatrizId(db);
  }
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [agenciaNombre] });
  if (res.rows.length === 0) {
    throw new Error(`Agencia "${agenciaNombre}" no existe en la tabla agencias`);
  }
  return res.rows[0].id as number;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const departamento = req.nextUrl.searchParams.get("departamento");
    const agenciaNombre = req.nextUrl.searchParams.get("agencia");
    const grupo = req.nextUrl.searchParams.get("grupo");
    const ejercicio = await ejercicioDe(req);

    // Consolidado (solo lectura): suma de las 10 agencias por departamento, cuenta y mes
    if (agenciaNombre === "Consolidado") {
      const cond = ["ejercicio = ?"];
      const a: (string | number)[] = [ejercicio];
      if (departamento) { cond.push("departamento = ?"); a.push(departamento); }
      if (grupo) { cond.push("concepto LIKE ?"); a.push(`${grupo}%`); }
      const r = await db.execute({
        sql: `SELECT NULL AS id, departamento, concepto, MAX(cuenta_nombre) AS cuenta_nombre, mes, SUM(monto) AS monto,
                     NULL AS nota, MAX(modo) AS modo, NULL AS resumen_id, 'consolidado' AS origen
              FROM presupuesto_departamental WHERE ${cond.join(" AND ")}
              GROUP BY departamento, concepto, mes ORDER BY departamento, concepto, mes`,
        args: a,
      });
      return NextResponse.json({ filas: r.rows, consolidado: true });
    }

    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    const condiciones = ["agencia_id = ?", "ejercicio = ?"];
    const args: (string | number)[] = [agenciaId, ejercicio];
    if (departamento) {
      condiciones.push("departamento = ?");
      args.push(departamento);
    }
    if (grupo) {
      condiciones.push("concepto LIKE ?");
      args.push(`${grupo}%`);
    }

    const sql = `SELECT id, departamento, concepto, cuenta_nombre, mes, monto, nota, modo, resumen_id, origen
                 FROM presupuesto_departamental WHERE ${condiciones.join(" AND ")}
                 ORDER BY departamento, concepto, mes`;

    const res = await db.execute({ sql, args });
    return NextResponse.json({ filas: res.rows });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo el presupuesto departamental" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { departamento, concepto, cuenta_nombre, mes, monto, nota, modo, resumen_id, agencia, origen, ejercicio } = body;
    // Las cuentas que calcula la herramienta no se cargan a mano (lo cargado no llegaría al resultado)
    const calculada = concepto ? cuentaCalculada(String(concepto)) : null;
    if (calculada) {
      return NextResponse.json({ error: `La cuenta ${concepto} la calcula la herramienta y no se carga a mano. ${calculada}.` }, { status: 400 });
    }
    const ejercicioFinal = ejercicio ?? (await ejercicioPorDefecto());

    // { accion: "igualarEstructura" }: mismas cuentas de egresos en las 10 agencias (las que faltan, en 0)
    if (body.accion === "igualarEstructura") {
      return NextResponse.json(await igualarEstructuraEgresos(db, Number(ejercicioFinal)));
    }
    // { accion: "completarHistorico", aplicar }: las 10 agencias con su histórico en las cuentas que no calcula la herramienta
    // (aplicar: false → solo devuelve qué se haría, sin escribir)
    if (body.accion === "completarHistorico") {
      return NextResponse.json(await completarHistorico(db, Number(ejercicioFinal), body.aplicar === true, body.todo === true));
    }
    // { accion: "historicoTodas", departamento, grupo, crecimiento, reparto }: llena con el histórico de cada agencia
    if (body.accion === "historicoTodas") {
      if (!departamento || !body.grupo) return NextResponse.json({ error: "Faltan la hoja y el grupo." }, { status: 400 });
      return NextResponse.json(await historicoEnTodas(db, String(departamento), String(body.grupo), Number(ejercicioFinal),
        Number(body.crecimiento) || 0, body.reparto === "parejo" ? "parejo" : "estacional"));
    }

    // Lo que sigue guarda en una agencia: debe venir y no puede ser el Consolidado (antes, sin agencia iba a Matriz)
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(agencia));

    // { montosPorMes: [12] }: crea los 12 meses de una línea directa en un solo lote (antes, 12 llamadas).
    if (Array.isArray(body.montosPorMes)) {
      if (!departamento || !concepto) {
        return NextResponse.json({ error: "Faltan campos: departamento y concepto son obligatorios" }, { status: 400 });
      }
      meses(body.montosPorMes, `Cuenta ${concepto}`, {}, true);
      // Un mes en null no se crea (así lo usa Plan de adquisiciones: solo los meses con compra).
      const montos = (body.montosPorMes as (number | null)[]).slice(0, 12)
        .map((m, i) => ({ m, i })).filter((x) => x.m !== null && x.m !== undefined);
      if (!montos.length) return NextResponse.json({ creados: 0 });
      const esEgreso = /^4/.test(String(concepto).replace(/\D/g, ""));
      // Si la cuenta ya existe en esta hoja y agencia (ej. en 0 porque se creó en otra, un doble clic o un reintento),
      // se actualiza en lugar de duplicarla: una fila repetida se sumaría dos veces en el Estado de resultados.
      {
        const prev = await db.execute({
          sql: `SELECT id, mes FROM presupuesto_departamental WHERE departamento = ? AND concepto = ? AND agencia_id = ? AND ejercicio = ? ORDER BY id`,
          args: [departamento, concepto, agenciaId, ejercicioFinal],
        });
        if (prev.rows.length) {
          const idPorMes = new Map<number, number>();
          for (const r of prev.rows) if (!idPorMes.has(Number(r.mes))) idPorMes.set(Number(r.mes), Number(r.id));
          await db.batch(montos.map(({ m, i }) => idPorMes.has(i + 1)
            ? { sql: `UPDATE presupuesto_departamental SET monto = ?, cuenta_nombre = COALESCE(?, cuenta_nombre), origen = ? WHERE id = ?`, args: [Number(m) || 0, cuenta_nombre ?? null, origen ?? "manual", idPorMes.get(i + 1)!] }
            : { sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, nota, agencia_id, modo, resumen_id, origen, ejercicio) VALUES (?, ?, ?, ?, ?, ?, ?, 'directo', NULL, ?, ?)`,
                args: [departamento, concepto, cuenta_nombre ?? null, i + 1, Number(m) || 0, nota ?? null, agenciaId, origen ?? "manual", ejercicioFinal] }), "write");
          return NextResponse.json({ actualizados: montos.length });
        }
      }
      await db.batch(montos.map(({ m, i }) => ({
        sql: `INSERT INTO presupuesto_departamental
                (departamento, concepto, cuenta_nombre, mes, monto, nota, agencia_id, modo, resumen_id, origen, ejercicio)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'directo', NULL, ?, ?)`,
        args: [departamento, concepto, cuenta_nombre ?? null, i + 1, Number(m) || 0, nota ?? null, agenciaId, origen ?? "manual", ejercicioFinal],
      })), "write");
      // Egresos: la misma cuenta se crea en las demás agencias (en 0) para que todas tengan la misma estructura
      if (esEgreso) await replicarEnAgencias(db, String(departamento), String(concepto), cuenta_nombre ?? null, Number(ejercicioFinal));
      return NextResponse.json({ creados: montos.length });
    }

    if (!departamento || !concepto || !mes || monto === undefined) {
      return NextResponse.json({ error: "Faltan campos: departamento, concepto, mes, monto son obligatorios" }, { status: 400 });
    }
    if (mes < 1 || mes > 12) {
      return NextResponse.json({ error: "mes debe estar entre 1 y 12" }, { status: 400 });
    }
    validarMonto(monto, `Cuenta ${concepto}`);
    const modoFinal: Modo = modo === "prorrateado" ? "prorrateado" : "directo";
    if (modoFinal === "prorrateado" && !resumen_id) {
      return NextResponse.json({ error: "Un registro prorrateado necesita resumen_id" }, { status: 400 });
    }

    const res = await db.execute({
      sql: `INSERT INTO presupuesto_departamental
              (departamento, concepto, cuenta_nombre, mes, monto, nota, agencia_id, modo, resumen_id, origen, ejercicio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [departamento, concepto, cuenta_nombre ?? null, mes, monto, nota ?? null, agenciaId, modoFinal, resumen_id ?? null, origen ?? "manual", ejercicioFinal],
    });

    return NextResponse.json({ id: Number(res.lastInsertRowid) });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el registro" }, { status: 500 });
  }
}

/**
 * Cambia el modo de un CONCEPTO, siempre dentro de un mismo ejercicio (dos
 * conceptos con el mismo departamento+concepto pero en años distintos son
 * entidades separadas, nunca deben mezclarse).
 *
 * - "directo": cada agencia mete su propio valor en Gastos. Solo limpia
 *   modo/resumen_id de las filas que ya existan (el valor actual se queda
 *   como punto de partida editable).
 *
 * - "prorrateado": el monto sale de "Valores institucionales"
 *   (presupuesto_resumen) y se reparte entre las 10 agencias según su % de
 *   Activo (calcularActivosYPorcentajesAgencias). Actualiza/crea la fila de
 *   cada agencia para cada mes.
 */
/** Crea la cuenta (12 meses en 0, directa) en las agencias que no la tienen en esa hoja y ejercicio. */
async function replicarEnAgencias(db: Db, departamento: string, concepto: string, cuentaNombre: string | null, ejercicio: number) {
  const faltan = await db.execute({
    sql: `SELECT id FROM agencias WHERE id NOT IN (
            SELECT DISTINCT agencia_id FROM presupuesto_departamental WHERE departamento = ? AND concepto = ? AND ejercicio = ? AND agencia_id IS NOT NULL)`,
    args: [departamento, concepto, ejercicio],
  });
  const lote = faltan.rows.flatMap((a) => Array.from({ length: 12 }, (_, i) => ({
    sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, origen, ejercicio)
          VALUES (?, ?, ?, ?, 0, ?, 'directo', 'estructura', ?)`,
    args: [departamento, concepto, cuentaNombre, i + 1, Number(a.id), ejercicio] as (string | number | null)[],
  })));
  for (let k = 0; k < lote.length; k += 360) await db.batch(lote.slice(k, k + 360), "write");
  return faltan.rows.length;
}

/**
 * Iguala la estructura de egresos (grupo 4) en las 10 agencias: toda cuenta que exista en alguna agencia (misma hoja)
 * se crea en las que no la tienen, en 0. Las cuentas que calcula la herramienta no se replican.
 */
async function igualarEstructuraEgresos(db: Db, ejercicio: number) {
  const [cuentas, agencias, existentes] = await Promise.all([
    db.execute({ sql: `SELECT departamento, concepto, MAX(cuenta_nombre) AS cuenta_nombre FROM presupuesto_departamental
                       WHERE ejercicio = ? AND concepto LIKE '4%' AND agencia_id IS NOT NULL GROUP BY departamento, concepto`, args: [ejercicio] }),
    db.execute(`SELECT id FROM agencias`),
    db.execute({ sql: `SELECT DISTINCT departamento, concepto, agencia_id FROM presupuesto_departamental WHERE ejercicio = ? AND concepto LIKE '4%'`, args: [ejercicio] }),
  ]);
  const tiene = new Set(existentes.rows.map((r) => `${r.departamento}|${r.concepto}|${r.agencia_id}`));
  const lote: { sql: string; args: (string | number | null)[] }[] = [];
  let cuentasCreadas = 0;
  for (const c of cuentas.rows) {
    const concepto = String(c.concepto);
    if (cuentaCalculada(concepto)) continue;
    for (const a of agencias.rows) {
      if (tiene.has(`${c.departamento}|${concepto}|${a.id}`)) continue;
      cuentasCreadas++;
      for (let mes = 1; mes <= 12; mes++) lote.push({
        sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, origen, ejercicio)
              VALUES (?, ?, ?, ?, 0, ?, 'directo', 'estructura', ?)`,
        args: [String(c.departamento), concepto, (c.cuenta_nombre as string | null) ?? null, mes, Number(a.id), ejercicio],
      });
    }
  }
  for (let k = 0; k < lote.length; k += 360) await db.batch(lote.slice(k, k + 360), "write");
  return { cuentasCreadas, filas: lote.length };
}

/**
 * Llena las cuentas de una hoja en las 10 agencias con el histórico de cada agencia (Históricos: lib/base-historica.ts).
 * Solo cuentas directas que están en 0 o que faltan en la agencia; no toca las prorrateadas (salen del monto
 * institucional) ni las que ya tienen valores, ni las que calcula la herramienta.
 */
async function historicoEnTodas(db: Db, departamento: string, grupo: string, ejercicio: number, crecimiento: number, reparto: "estacional" | "parejo") {
  const [agencias, filas] = await Promise.all([
    db.execute(`SELECT id, nombre FROM agencias`),
    db.execute({ sql: `SELECT id, agencia_id, concepto, cuenta_nombre, mes, monto, modo FROM presupuesto_departamental
                       WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ?`, args: [departamento, `${grupo}%`, ejercicio] }),
  ]);
  const bases = { rows: await baseHistorica(db, ejercicio, grupo, agencias.rows.map((a) => String(a.nombre))) };
  const prorrateadas = new Set(filas.rows.filter((r) => r.modo === "prorrateado").map((r) => String(r.concepto)));
  const conceptos = [...new Set(filas.rows.map((r) => String(r.concepto)))].filter((c) => !prorrateadas.has(c) && !cuentaCalculada(c));
  const nombre = new Map(filas.rows.map((r) => [String(r.concepto), (r.cuenta_nombre as string | null) ?? null]));
  const base = new Map(bases.rows.map((b) => [`${b.agencia}|${b.codigo}`, b]));
  const lote: { sql: string; args: (string | number | null)[] }[] = [];
  let llenadas = 0, sinHistorico = 0;
  for (const a of agencias.rows) {
    const agId = Number(a.id);
    for (const c of conceptos) {
      const propias = filas.rows.filter((r) => Number(r.agencia_id) === agId && String(r.concepto) === c);
      if (propias.some((r) => Math.abs(Number(r.monto) || 0) >= 0.005)) continue; // ya tiene valores: no se toca
      const b = base.get(`${a.nombre}|${c}`);
      const montos = b && Number(b.base_ttm) ? calcularMontosMensuales(Number(b.base_ttm), (b.pesos_mensuales as string | null) ?? null, crecimiento, reparto) : null;
      if (!montos) { sinHistorico++; if (propias.length) continue; }
      const idPorMes = new Map<number, number>();
      for (const r of propias) if (!idPorMes.has(Number(r.mes))) idPorMes.set(Number(r.mes), Number(r.id));
      for (let mes = 1; mes <= 12; mes++) {
        const monto = montos ? montos[mes - 1] : 0;
        if (idPorMes.has(mes)) lote.push({ sql: `UPDATE presupuesto_departamental SET monto = ?, origen = 'sugerido' WHERE id = ?`, args: [monto, idPorMes.get(mes)!] });
        else lote.push({ sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, origen, ejercicio)
                               VALUES (?, ?, ?, ?, ?, ?, 'directo', ?, ?)`, args: [departamento, c, nombre.get(c) ?? null, mes, monto, agId, montos ? "sugerido" : "estructura", ejercicio] });
      }
      if (montos) llenadas++;
    }
  }
  for (let k = 0; k < lote.length; k += 360) await db.batch(lote.slice(k, k + 360), "write");
  return { llenadas, sinHistorico, prorrateadas: prorrateadas.size };
}

async function cambiarModoConcepto(
  db: Db,
  body: {
    departamento?: string; concepto?: string; cuenta_nombre?: string | null;
    nuevoModo?: string; resumenNombre?: string; ejercicio?: number;
  }
) {
  const { departamento, concepto, cuenta_nombre, nuevoModo, resumenNombre } = body;
  const ejercicio = body.ejercicio ?? (await ejercicioPorDefecto());
  if (!departamento || !concepto || !nuevoModo) {
    return NextResponse.json({ error: "Faltan campos: departamento, concepto, nuevoModo" }, { status: 400 });
  }

  if (nuevoModo === "directo") {
    await db.execute({
      sql: `UPDATE presupuesto_departamental SET modo = 'directo', resumen_id = NULL
            WHERE departamento = ? AND concepto = ? AND ejercicio = ?`,
      args: [departamento, concepto, ejercicio],
    });
    return NextResponse.json({ actualizado: true });
  }

  if (nuevoModo !== "prorrateado") {
    return NextResponse.json({ error: "nuevoModo debe ser 'directo' o 'prorrateado'" }, { status: 400 });
  }
  if (!resumenNombre) {
    return NextResponse.json({ error: "Falta resumenNombre" }, { status: 400 });
  }

  const resumenRows = await db.execute({
    sql: `SELECT id, mes, monto FROM presupuesto_resumen WHERE departamento = ? AND nombre = ? AND ejercicio = ? ORDER BY mes`,
    args: [departamento, resumenNombre, ejercicio],
  });
  if (resumenRows.rows.length !== 12) {
    return NextResponse.json(
      { error: `La línea "${resumenNombre}" de Valores institucionales no tiene los 12 meses cargados` },
      { status: 400 }
    );
  }
  const resumenPorMes = new Map<number, { id: number; monto: number }>();
  for (const r of resumenRows.rows) {
    resumenPorMes.set(r.mes as number, { id: r.id as number, monto: r.monto as number });
  }

  const { porcentajes } = await calcularActivosYPorcentajesAgencias(db);
  const agenciasRes = await db.execute({ sql: `SELECT id, nombre FROM agencias` });

  const existentes = await db.execute({
    sql: `SELECT id, agencia_id, mes FROM presupuesto_departamental WHERE departamento = ? AND concepto = ? AND ejercicio = ?`,
    args: [departamento, concepto, ejercicio],
  });
  const existentePorAgenciaMes = new Map<string, number>();
  for (const r of existentes.rows) {
    existentePorAgenciaMes.set(`${r.agencia_id}-${r.mes}`, r.id as number);
  }

  // Las 120 filas (10 agencias × 12 meses) se graban en un solo lote.
  const lote: { sql: string; args: (string | number | null)[] }[] = [];
  for (const ag of agenciasRes.rows) {
    const agenciaId = ag.id as number;
    const agenciaNombre = ag.nombre as string;
    const pct = porcentajes[agenciaNombre] ?? 0;
    for (let mes = 1; mes <= 12; mes++) {
      const resumen = resumenPorMes.get(mes)!;
      const monto = resumen.monto * pct;
      const idExistente = existentePorAgenciaMes.get(`${agenciaId}-${mes}`);
      if (idExistente) {
        lote.push({
          sql: `UPDATE presupuesto_departamental
                SET monto = ?, modo = 'prorrateado', resumen_id = ?, cuenta_nombre = COALESCE(?, cuenta_nombre)
                WHERE id = ?`,
          args: [monto, resumen.id, cuenta_nombre ?? null, idExistente],
        });
      } else {
        lote.push({
          sql: `INSERT INTO presupuesto_departamental
                  (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, resumen_id, ejercicio)
                VALUES (?, ?, ?, ?, ?, ?, 'prorrateado', ?, ?)`,
          args: [departamento, concepto, cuenta_nombre ?? null, mes, monto, agenciaId, resumen.id, ejercicio],
        });
      }
    }
  }
  if (lote.length) await db.batch(lote, "write");

  return NextResponse.json({ actualizado: true });
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();

    if (body.accion === "cambiar_modo") {
      return await cambiarModoConcepto(db, body);
    }

    // { cambios: [{ id, monto }, ...] }: los 12 meses en una sola llamada y un solo lote.
    if (Array.isArray(body.cambios)) {
      const cambios = (body.cambios as { id: number; monto: number }[]).filter((c) => c && c.id && c.monto !== undefined);
      // Todos los montos se revisan antes de grabar: o se guardan todos o ninguno
      const valores = cambios.map((c) => validarMonto(c.monto, "Monto"));
      if (cambios.length) {
        await db.batch(cambios.map((c, i) => ({ sql: `UPDATE presupuesto_departamental SET monto = ?, origen = 'manual' WHERE id = ?`, args: [valores[i], c.id] })), "write");
      }
      return NextResponse.json({ actualizado: true, n: cambios.length });
    }

    const { id, monto } = body;
    if (!id || monto === undefined) {
      return NextResponse.json({ error: "Faltan campos: id y monto son obligatorios" }, { status: 400 });
    }

    await db.execute({
      sql: `UPDATE presupuesto_departamental SET monto = ?, origen = 'manual' WHERE id = ?`,
      args: [validarMonto(monto, "Monto"), id],
    });

    return NextResponse.json({ actualizado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error actualizando el registro" }, { status: 500 });
  }
}

/**
 * DELETE ?id=123 -> borra una fila puntual (un mes, una agencia)
 * DELETE ?departamento=X&concepto=Y&ejercicio=Z -> borra TODAS las filas de
 *   ese concepto en ese ejercicio, en TODAS las agencias.
 */
export async function DELETE(req: NextRequest) {
  try {
    const db = getDb();
    const id = req.nextUrl.searchParams.get("id");
    const departamento = req.nextUrl.searchParams.get("departamento");
    const concepto = req.nextUrl.searchParams.get("concepto");
    const ejercicio = await ejercicioDe(req);

    // ?ids=1,2,3: varias filas en una sola llamada
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0);
    if (ids.length) {
      await db.execute({ sql: `DELETE FROM presupuesto_departamental WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
      return NextResponse.json({ eliminado: true, n: ids.length });
    }
    if (id) {
      await db.execute({ sql: `DELETE FROM presupuesto_departamental WHERE id = ?`, args: [id] });
      return NextResponse.json({ eliminado: true });
    }
    if (departamento && concepto) {
      await db.execute({
        sql: `DELETE FROM presupuesto_departamental WHERE departamento = ? AND concepto = ? AND ejercicio = ?`,
        args: [departamento, concepto, ejercicio],
      });
      return NextResponse.json({ eliminado: true });
    }
    return NextResponse.json({ error: "Falta id, o departamento+concepto" }, { status: 400 });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error eliminando el registro" }, { status: 500 });
  }
}