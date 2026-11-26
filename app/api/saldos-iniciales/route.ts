import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, mes as mesValido, monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { tomarInstantanea } from "../../../lib/instantaneas";
import { getOrCreateMatrizId } from "../../../lib/agencias";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

function inferirGrupo(codigo: string): "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "GASTO" {
  switch (codigo.charAt(0)) {
    case "1": return "ACTIVO";
    case "2": return "PASIVO";
    case "3": return "PATRIMONIO";
    case "5": return "INGRESO";
    case "4": return "GASTO";
    default: return "ACTIVO";
  }
}

/** GET ?agencia=El Guabo&anio=2025&mes=12 -- si se omite agencia/anio/mes, usa Matriz/2025/12 (comportamiento anterior). */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const anio = Number(req.nextUrl.searchParams.get("anio") ?? "2025");
    const mes = Number(req.nextUrl.searchParams.get("mes") ?? "12");
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    const [filasRes, cargasRes] = await Promise.all([
      db.execute({
        sql: `SELECT si.cuenta_codigo AS codigo, cc.nombre AS nombre, si.monto AS saldo
              FROM saldos_iniciales si
              JOIN catalogo_cuentas cc ON cc.codigo = si.cuenta_codigo
              WHERE si.agencia_id = ? AND si.anio = ? AND si.mes = ?`,
        args: [agenciaId, anio, mes],
      }),
      db.execute({
        sql: `SELECT sc.agencia_id AS agenciaId, a.nombre AS agenciaNombre,
                     sc.anio AS anio, sc.mes AS mes,
                     sc.registros_count AS registrosCount, sc.cargado_en AS cargadoEn
              FROM saldos_cargas sc
              JOIN agencias a ON a.id = sc.agencia_id
              ORDER BY sc.cargado_en DESC`,
        args: [],
      }),
    ]);

    return NextResponse.json({ filas: filasRes.rows, cargas: cargasRes.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo saldos iniciales" }, { status: 500 });
  }
}

interface FilaEntrada {
  codigo: string;
  nombre: string;
  saldo: number;
}

/** POST { filas, agencia, anio, mes } -- agencia/anio/mes vienen del archivo (detectados) o de lo que confirme el usuario.
 *  Reemplaza por completo el balance de esa agencia en ese año/mes. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { filas: FilaEntrada[]; agencia?: string; anio?: number; mes?: number };
    if (!Array.isArray(body.filas) || body.filas.length === 0) {
      return NextResponse.json({ error: "Se esperaba { filas: [...] } con al menos una fila" }, { status: 400 });
    }
    if (!body.agencia || !body.anio || !body.mes) {
      return NextResponse.json({ error: "Faltan campos: agencia, anio y mes son obligatorios" }, { status: 400 });
    }

    // Todo se revisa antes de borrar nada: agencia válida, mes 1–12 y saldos numéricos
    const nombreAgencia = agenciaParaGuardar(body.agencia);
    const anio = validarMonto(body.anio, "Año", { min: 2000, max: 2100, enteros: true });
    const mes = mesValido(body.mes);
    const saldos = body.filas.map((f) => validarMonto(f.saldo, `Saldo de la cuenta ${f.codigo}`));
    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, nombreAgencia);

    // La carga REEMPLAZA el balance de esa agencia y ese mes: primero se borra
    // lo que hubiera (incluidas cuentas sueltas de cargas anteriores o
    // incompletas) y luego se guarda el archivo completo. Todo en un solo
    // batch: si algo falla, no queda nada a medias.
    const statements: { sql: string; args: (string | number)[] }[] = [
      { sql: `DELETE FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agenciaId, anio, mes] },
    ];
    let guardadas = 0;

    for (const [n, fila] of body.filas.entries()) {
      const codigo = String(fila.codigo).trim();
      if (!codigo) continue;

      statements.push({
        sql: `INSERT INTO catalogo_cuentas (codigo, nombre, grupo, nivel)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(codigo) DO UPDATE SET nombre = CASE
                WHEN catalogo_cuentas.nombre IS NULL OR TRIM(catalogo_cuentas.nombre) = '' OR catalogo_cuentas.nombre = catalogo_cuentas.codigo OR catalogo_cuentas.nombre LIKE 'Cuenta %'
                THEN excluded.nombre ELSE catalogo_cuentas.nombre END`,
        args: [codigo, fila.nombre || codigo, inferirGrupo(codigo), codigo.replace(/\./g, "").length],
      });
      statements.push({
        sql: `INSERT INTO saldos_iniciales (agencia_id, cuenta_codigo, anio, mes, monto)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(agencia_id, cuenta_codigo, anio, mes) DO UPDATE SET monto = excluded.monto`,
        args: [agenciaId, codigo, anio, mes, saldos[n]],
      });
      guardadas++;
    }

    statements.push({
      sql: `INSERT INTO saldos_cargas (agencia_id, anio, mes, registros_count, cargado_en)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(agencia_id, anio, mes) DO UPDATE SET
              registros_count = excluded.registros_count,
              cargado_en = excluded.cargado_en`,
      args: [agenciaId, anio, mes, guardadas],
    });

    await db.batch(statements, "write");

    return NextResponse.json({ ok: true, guardadas });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando saldos iniciales" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agenciaId = Number(searchParams.get("agenciaId"));
    if (!agenciaId) {
      return NextResponse.json({ error: "Falta agenciaId" }, { status: 400 });
    }
    const anio = Number(searchParams.get("anio") ?? "2025");
    const mes = Number(searchParams.get("mes") ?? "12");

    const db = getDb();
    // Copia del corte (restaurable desde la Bitácora). Sin copia no se elimina.
    const ag = await db.execute({ sql: `SELECT nombre FROM agencias WHERE id = ?`, args: [agenciaId] });
    await tomarInstantanea(`Corte de saldos ${mes}/${anio} de ${String(ag.rows[0]?.nombre ?? `agencia ${agenciaId}`)}`, [
      { tabla: "saldos_iniciales", where: "agencia_id = ? AND anio = ? AND mes = ?", args: [agenciaId, anio, mes] },
      { tabla: "saldos_cargas", where: "agencia_id = ? AND anio = ? AND mes = ?", args: [agenciaId, anio, mes] },
    ]);
    await db.batch(
      [
        { sql: `DELETE FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agenciaId, anio, mes] },
        { sql: `DELETE FROM saldos_cargas WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agenciaId, anio, mes] },
      ],
      "write"
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error eliminando la carga" }, { status: 500 });
  }
}