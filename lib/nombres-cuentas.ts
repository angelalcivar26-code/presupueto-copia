import type { getDb } from "./turso";

type Nodo = { codigo: string; label: string; hijos?: Nodo[] };

/**
 * Pone el nombre del catálogo a las filas cuyo nombre es solo su código (cuentas tomadas del corte o del detalle).
 * Una sola lectura por cada 400 códigos; si el catálogo no responde, las filas quedan con su código.
 */
export async function nombrarCuentas(db: ReturnType<typeof getDb>, raices: (Nodo | undefined | null)[]): Promise<void> {
  const sinNombre = new Set<string>();
  const ir = (n: Nodo) => { if (/^\d+$/.test(n.codigo) && (!n.label || n.label === n.codigo)) sinNombre.add(n.codigo); n.hijos?.forEach(ir); };
  raices.forEach((r) => r && ir(r));
  if (!sinNombre.size) return;
  const cods = [...sinNombre], nombres: Record<string, string> = {};
  try {
    for (let k = 0; k < cods.length; k += 400) {
      const parte = cods.slice(k, k + 400);
      const r = await db.execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${parte.map(() => "?").join(",")})`, args: parte });
      for (const x of r.rows) nombres[String(x.codigo)] = String(x.nombre ?? "");
    }
  } catch (e) { console.error("[nombres] catálogo no disponible", e); return; }
  const poner = (n: Nodo) => { if (/^\d+$/.test(n.codigo) && (!n.label || n.label === n.codigo) && nombres[n.codigo]) n.label = nombres[n.codigo]; n.hijos?.forEach(poner); };
  raices.forEach((r) => r && poner(r));
}
