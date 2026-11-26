import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId, resolverCorteSaldos } from "../../../lib/insumos-agencia";
import { detectarPrestamosInternos } from "../../../lib/calc/ingresos-51";
import { transferenciasInternas, proyectarPrestamoTI } from "../../../lib/prestamos-internos";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];

/**
 * GET ?ejercicio=2027
 * Préstamos internos de las 10 agencias, leídos del balance de corte más reciente de cada una:
 *   presta : subcuentas de 1908 que dicen "préstamo" (la agencia cobra interés → 5190)
 *   recibe : subcuentas de 2908 que dicen "préstamo" (la agencia paga interés → 41059005)
 *   otras1908 / otras2908 : el resto de subcuentas (transferencias), para revisar que nada quede fuera
 * Control: lo prestado por todas debe ser igual a lo recibido por todas (se elimina en el consolidado).
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const cat = await db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo LIKE '1908%' OR codigo LIKE '2908%'`)
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const catalogo = cat.rows.map((r) => ({ codigo: String(r.codigo), nombre: String(r.nombre ?? "") }));
    const nombreDe = (codigo: string) => catalogo.find((c) => c.codigo === codigo)?.nombre ?? "";

    const ti = await transferenciasInternas(db, ejercicio);
    // Las 10 agencias se leen al mismo tiempo (antes, una tras otra)
    const porAgencia = await Promise.all(AGENCIAS.map(async (agencia) => {
      let agenciaId: number;
      try { agenciaId = await resolverAgenciaId(db, agencia); } catch { return null; }
      const corte = await resolverCorteSaldos(db, agenciaId);
      const [sal, par] = await Promise.all([
        db.execute({
          sql: `SELECT cuenta_codigo, monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ? AND (cuenta_codigo LIKE '1908%' OR cuenta_codigo LIKE '2908%')`,
          args: [agenciaId, corte.anio, corte.mes],
        }),
        db.execute({
          sql: `SELECT concepto, mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'ingresos_tasa_prestamos_internos'`,
          args: [agenciaId, ejercicio],
        }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);
      const saldos: Record<string, number> = {};
      for (const r of sal.rows) saldos[String(r.cuenta_codigo)] = Number(r.monto) || 0;
      const presta = detectarPrestamosInternos(catalogo, saldos, "1908");
      const recibe = detectarPrestamosInternos(catalogo, saldos, "2908");
      // interés del año como el motor: por días, con abonos y préstamos nuevos (Transferencias internas), tasa única
      const tasa = ti.tasa, t12 = Array(12).fill(tasa);
      const sumaI = (lado: "presta" | "recibe") => ti.prestamos.filter((p) => (lado === "presta" ? p.prestamista : p.deudora) === agencia)
        .reduce((t, p) => t + proyectarPrestamoTI(p, lado, t12, ejercicio).interes.reduce((s, v) => s + v, 0), 0);
      void par;

      // Subcuentas de último nivel que no son préstamos (para revisar)
      const codigos = Object.keys(saldos);
      const hojas = codigos.filter((k) => k.length > 4 && !codigos.some((o) => o !== k && o.startsWith(k)));
      const cubiertas = [...presta, ...recibe].map((c) => c.codigo);
      const otras = (prefijo: string) => hojas
        .filter((k) => k.startsWith(prefijo) && !cubiertas.some((c) => k.startsWith(c)) && Math.round(saldos[k]) !== 0)
        .map((k) => ({ codigo: k, nombre: nombreDe(k), saldo: saldos[k] }));

      return {
        agencia, corte, tasa, presta, recibe, interesCobrado: sumaI("presta"), interesPagado: sumaI("recibe"),
        totalPresta: presta.reduce((t, c) => t + c.saldo, 0),
        totalRecibe: recibe.reduce((t, c) => t + c.saldo, 0),
        otras1908: otras("1908"), otras2908: otras("2908"),
      };
    }));
    const agencias = porAgencia.filter((a) => a !== null);
    return NextResponse.json({ agencias });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los préstamos internos" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("prestamos-internos", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
