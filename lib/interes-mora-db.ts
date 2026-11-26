/**
 * Interés de mora real de una agencia (% del interés normal de la cartera), automático desde sus estados de resultados:
 *   (5104.50 del último mes − 5104.50 del mes anterior a la ventana) ÷ (interés normal de los mismos meses)
 *   interés normal = 5104 − 5104.50 (incluye la cartera refinanciada y reestructurada)
 * Meses: los sin alivio (desde el inicio de la ventana de la provisión) hasta el último estado de resultados cargado,
 * dentro del mismo año (el ER viene acumulado). null: la agencia no tiene esos meses o el ER no trae el detalle de 5104.
 */
import type { Client } from "@libsql/client";
import { leerConfig } from "./provision-flow-db";

type Db = Pick<Client, "execute">;
const mesAntes = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export async function interesMoraRealAgencia(db: Db, oficina: string, hastaMax?: string): Promise<{ valor: number; desde: string; hasta: string } | null> {
  const desde = await leerConfig(db as Client).then((c) => c.ventanaDesde).catch(() => "");
  if (!desde) return null;
  const r = await db.execute({
    sql: `SELECT periodo, codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND codigo >= '5104' AND codigo < '5105' AND LENGTH(codigo) <= 6 AND oficina = ? AND periodo >= ?`,
    args: [oficina, mesAntes(desde)],
  });
  const por = new Map<string, Record<string, number>>();
  for (const x of r.rows) { const p = String(x.periodo); const o = por.get(p) ?? {}; o[String(x.codigo)] = Number(x.valor) || 0; por.set(p, o); }
  // último mes con 5104 y su detalle (si el ER vino a 4 dígitos no se puede saber la mora)
  const meses = [...por.keys()].filter((p) => p >= desde && (!hastaMax || p <= hastaMax) && por.get(p)!["5104"] !== undefined && Object.keys(por.get(p)!).some((k) => k.length === 6)).sort();
  const hasta = meses[meses.length - 1];
  if (!hasta) return null;
  const anio = hasta.slice(0, 4);
  // base: el mes anterior a la ventana si es del mismo año; si la ventana empieza en enero o en otro año, desde enero
  const inicio = desde.slice(0, 4) === anio ? desde : `${anio}-01`;
  const base = inicio.endsWith("-01") ? null : por.get(mesAntes(inicio));
  // falta el mes anterior, o vino sin el detalle de 5104: no se puede restar el acumulado
  if (base === undefined || (base && !Object.keys(base).some((k) => k.length === 6))) return null;
  const v = (o: Record<string, number> | null | undefined, k: string) => (o ? o[k] ?? 0 : 0);
  const fin = por.get(hasta)!;
  const mora = v(fin, "510450") - v(base, "510450");
  const normal = v(fin, "5104") - v(base, "5104") - mora;
  if (normal <= 0) return null;
  return { valor: Math.max(0, mora / normal), desde: inicio, hasta };
}
