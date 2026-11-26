import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * Estado del ejercicio para Inicio: por cada sección, qué agencias tienen lo que el cálculo necesita
 * (lectura directa de la base, sin correr el motor). Una agencia está "completa" cuando cumple todas las secciones.
 * GET ?ejercicio=2027 → { agencias: string[], secciones: { id, label, href, listas: string[], faltan: Record<agencia, motivo> }[] }
 */
type Db = ReturnType<typeof getDb>;
type Fila = Record<string, unknown>;
/** Devuelve, por agencia, null si cumple o el motivo de lo que falta (agencias sin fila = motivo por defecto). */
type Evaluar = (db: Db, ejercicio: number, ids: number[]) => Promise<Map<number, string | null>>;
interface Sec { id: string; label: string; href: string; vacio: string; evaluar: Evaluar }

const PRODUCTOS = [["VISTA", "Ahorro a la vista"], ["CRECER", "Ahorro Crecer"], ["DPF", "Depósitos a plazo"]] as const;
const LINEAS = [["PRODUCTIVO", "Productivo"], ["CONSUMO", "Consumo"], ["INMOBILIARIO", "Inmobiliario"], ["MICROCREDITO", "Microcrédito"]] as const;

async function filas(db: Db, sql: string, args: (string | number)[] = []): Promise<Fila[]> {
  // una tabla que todavía no existe (nunca se cargó nada) = ninguna agencia lista
  const r = await db.execute({ sql, args }).catch(() => ({ rows: [] as Fila[] }));
  return r.rows as Fila[];
}

/** Con datos = cumple (para secciones donde basta que exista lo cargado). */
function conDatos(sql: string, conEjercicio = false): Evaluar {
  return async (db, ejercicio, ids) => {
    const r = await filas(db, sql, conEjercicio ? [ejercicio] : []);
    const hay = new Set(r.map((x) => Number(x.a)));
    const todas = hay.has(-1); // partidas de toda la cooperativa: cuentan para las 10 agencias
    return new Map(ids.filter((id) => todas || hay.has(id)).map((id) => [id, null]));
  };
}

/** Cada producto o línea con sus 12 meses guardados. */
function doceMeses(tabla: string, campo: string, lista: readonly (readonly [string, string])[]): Evaluar {
  return async (db, _e, ids) => {
    const r = await filas(db, `SELECT agencia_id AS a, ${campo} AS k, COUNT(DISTINCT mes) AS n FROM ${tabla} WHERE mes BETWEEN 1 AND 12 GROUP BY agencia_id, ${campo}`);
    const out = new Map<number, string | null>();
    for (const id of ids) {
      const deLa = r.filter((x) => Number(x.a) === id);
      if (!deLa.length) continue;
      const incompletos = lista.filter(([k]) => Number(deLa.find((x) => x.k === k)?.n ?? 0) < 12).map(([, nombre]) => nombre);
      out.set(id, incompletos.length ? `faltan meses de ${incompletos.join(", ")}` : null);
    }
    return out;
  };
}

/** Inversiones: solo se piden a la agencia que tiene saldo en la cuenta 13 en su balance de partida. */
const evaluarInversiones: Evaluar = async (db, ejercicio, ids) => {
  const [saldo, titulos] = await Promise.all([
    filas(db, `SELECT s.agencia_id AS a, SUM(s.monto) AS v FROM saldos_iniciales s
               JOIN (SELECT agencia_id, MAX(anio * 100 + mes) AS p FROM saldos_iniciales WHERE anio < ? GROUP BY agencia_id) c
                 ON c.agencia_id = s.agencia_id AND s.anio * 100 + s.mes = c.p
               WHERE s.cuenta_codigo LIKE '13__' GROUP BY s.agencia_id`, [ejercicio]),
    filas(db, `SELECT DISTINCT agencia_id AS a FROM inversiones`),
  ]);
  const conTitulos = new Set(titulos.map((x) => Number(x.a)));
  const conSaldo = new Map(saldo.map((x) => [Number(x.a), Number(x.v) || 0]));
  return new Map(ids.map((id) => [id, (conSaldo.get(id) ?? 0) > 0.005 && !conTitulos.has(id) ? "tiene saldo en la cuenta 13 sin títulos registrados" : null]));
};

const SECCIONES: Sec[] = [
  {
    id: "saldos", label: "Balance de partida", href: "/carga-datos", vacio: "falta el balance de corte anterior al ejercicio",
    evaluar: conDatos(`SELECT DISTINCT agencia_id AS a FROM saldos_iniciales WHERE anio < ?`, true),
  },
  { id: "captaciones", label: "Captaciones", href: "/captaciones", vacio: "sin parámetros", evaluar: doceMeses("parametros_captaciones", "producto", PRODUCTOS) },
  { id: "credito", label: "Cartera y crédito", href: "/cartera", vacio: "sin parámetros", evaluar: doceMeses("parametros_credito", "linea", LINEAS) },
  { id: "inversiones", label: "Inversiones", href: "/inversiones", vacio: "sin títulos", evaluar: evaluarInversiones },
  { id: "nomina", label: "Nómina", href: "/proyeccion-egresos", vacio: "sin empleados activos", evaluar: conDatos(`SELECT DISTINCT agencia_id AS a FROM nomina_empleados WHERE activo = 1`) },
  {
    id: "gastos", label: "Gastos", href: "/proyeccion-egresos", vacio: "sin gastos de operación",
    evaluar: conDatos(`SELECT DISTINCT agencia_id AS a FROM presupuesto_departamental WHERE ejercicio = ? AND (concepto LIKE '4502%' OR concepto LIKE '4503%' OR concepto LIKE '4507%') AND monto <> 0`, true),
  },
  {
    id: "ingresos", label: "Ingresos", href: "/proyeccion-ingresos", vacio: "sin otros ingresos",
    evaluar: conDatos(`SELECT DISTINCT agencia_id AS a FROM presupuesto_departamental WHERE ejercicio = ? AND (concepto LIKE '53%' OR concepto LIKE '54%' OR concepto LIKE '55%' OR concepto LIKE '56%') AND monto <> 0`, true),
  },
  { id: "activos-fijos", label: "Activos fijos", href: "/activos-fijos", vacio: "sin registro de bienes", evaluar: conDatos(`SELECT DISTINCT agencia_id AS a FROM activos_fijos WHERE ejercicio = ?`, true) },
  {
    id: "otros-activos", label: "Otros activos", href: "/otros-activos", vacio: "sin partidas",
    evaluar: conDatos(`SELECT DISTINCT CASE WHEN alcance = 'agencia' THEN agencia_id ELSE -1 END AS a FROM activos_diferidos`),
  },
];

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const ag = await db.execute(`SELECT id, nombre FROM agencias ORDER BY id`);
    const agencias = ag.rows.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) }));
    const ids = agencias.map((a) => a.id);
    const secciones = await Promise.all(SECCIONES.map(async (s) => {
      const estado = await s.evaluar(db, ejercicio, ids);
      const listas: string[] = [];
      const faltan: Record<string, string> = {};
      for (const a of agencias) {
        const e = estado.get(a.id);
        if (e === null) listas.push(a.nombre);
        else faltan[a.nombre] = e ?? s.vacio;
      }
      return { id: s.id, label: s.label, href: s.href, listas, faltan };
    }));
    return NextResponse.json({ agencias: agencias.map((a) => a.nombre), secciones });
  } catch (e) {
    console.error("[avance]", e);
    return NextResponse.json({ error: "No se pudo leer el avance del ejercicio" }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
