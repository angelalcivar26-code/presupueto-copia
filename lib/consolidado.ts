import { NextRequest, NextResponse } from "next/server";

/**
 * CONSOLIDADO = suma mensual de las 10 agencias.
 *
 * Se envuelve el GET (ya con su memoria) de una ruta: si piden agencia=Consolidado, se pide el
 * resultado de cada agencia y se suman. Reglas de la suma (sumarJSON):
 *  - números y listas de números (12 meses): se suman;
 *  - campos que son porcentajes, tasas, días, años o meses (ver NO_SUMAR): se toma el primero
 *    (y cada ruta puede recalcularlos en `ajustar`);
 *  - listas de filas: se juntan por su identificador (id, código, etiqueta…), así una cuenta
 *    que solo tiene una agencia también aparece;
 *  - fórmulas: se reemplazan por una nota, porque las de cada agencia traen sus propias cifras.
 * Las agencias sin balance cargado se saltan y se informan en `consolidado.faltantes`.
 */
const CONSOLIDADO = "Consolidado";
export const AGENCIAS_CONSOLIDADO = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];

// los identificadores (id) tampoco se suman: si no, la misma fila de dos agencias deja de reconocerse en la tercera
const NO_SUMAR = /^(pct|tasa|ratio|porcentaje|anio|mes|ejercicio|dias|baseDias|cobertura|morosidad|relacion|factor|regla|tipo|version|calcula)|Pct|Tasa|Ratio|Porcentaje|^diferencia|^id$/;
const NOTA = "Consolidado: suma de las 10 agencias. La fórmula de cada línea está en cada agencia.";
const CLAVES_ID = ["id", "codigo", "concepto", "linea", "producto", "label", "nombre", "mes"];

function idDe(o: Record<string, unknown>): string | null {
  const partes = CLAVES_ID.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "").map((k) => `${k}=${String(o[k])}`);
  return partes.length ? partes.join("|") : null;
}

function sumarJSON(a: unknown, b: unknown, clave = ""): unknown {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  if (clave === "formula" || clave === "formulas") return Array.isArray(a) ? a.map(() => NOTA) : NOTA;
  if (typeof a === "number" && typeof b === "number") return NO_SUMAR.test(clave) ? a : a + b;
  if (typeof a === "boolean" && typeof b === "boolean") return a || b; // "hay datos" en alguna agencia
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.every((x) => typeof x === "number" || x === null) && b.every((x) => typeof x === "number" || x === null)) {
      if (NO_SUMAR.test(clave)) return a;
      const n = Math.max(a.length, b.length);
      return Array.from({ length: n }, (_, i) => (Number(a[i]) || 0) + (Number(b[i]) || 0));
    }
    const objetos = (x: unknown[]) => x.every((y) => y && typeof y === "object" && !Array.isArray(y));
    if (objetos(a) && objetos(b)) {
      const ids = (a as Record<string, unknown>[]).map(idDe);
      const unicos = ids.every((x) => x !== null) && new Set(ids).size === ids.length;
      if (unicos) {
        // Unión por identificador. Una fila que solo tiene esta agencia se inserta justo después de la
        // fila que la precede en esa agencia (así 1104 queda junto a 1103 y no al final del grupo).
        const res: { k: string; v: Record<string, unknown> }[] = (a as Record<string, unknown>[]).map((x, i) => ({ k: ids[i] as string, v: { ...x } }));
        let anterior: string | null = null;
        for (const y of b as Record<string, unknown>[]) {
          const k = idDe(y) ?? `#${res.length}`;
          const i = res.findIndex((r) => r.k === k);
          if (i >= 0) res[i].v = sumarJSON(res[i].v, y) as Record<string, unknown>;
          else {
            const j = anterior === null ? -1 : res.findIndex((r) => r.k === anterior);
            res.splice(j + 1, 0, { k, v: y });
          }
          anterior = k;
        }
        return res.map((r) => r.v);
      }
      // Sin identificador: 12 elementos = meses (se suman por posición); otra cantidad = registros (se juntan)
      if (a.length === 12 && b.length === 12) return Array.from({ length: 12 }, (_, i) => sumarJSON(a[i], b[i]));
      return [...a, ...b];
    }
    return a;
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    // una cuenta con subcuentas en una agencia y sin ellas en otra: lo de la segunda va en "Sin detalle por subcuenta",
    // así las subcuentas del Consolidado siempre suman su cuenta (antes quedaban con solo una parte)
    const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
    const res: Record<string, unknown> = { ...sinDetalleSiHace(oa, ob) };
    for (const [k, v] of Object.entries(sinDetalleSiHace(ob, oa))) res[k] = sumarJSON(res[k], v, k);
    return res;
  }
  return a;
}

const esNodo = (n: Record<string, unknown>) => typeof n.codigo === "string" && Array.isArray(n.valores);
const tieneHijos = (n: Record<string, unknown>) => Array.isArray(n.hijos) && n.hijos.length > 0;
function sinDetalleSiHace(n: Record<string, unknown>, otro: Record<string, unknown>): Record<string, unknown> {
  if (!esNodo(n) || !esNodo(otro) || tieneHijos(n) || !tieneHijos(otro)) return n;
  const valores = n.valores as unknown[];
  if (!valores.some((v) => Math.abs(Number(v) || 0) >= 0.005)) return n;
  return { ...n, hijos: [{ codigo: n.codigo, label: "Sin detalle por subcuenta", valores: [...valores], sinDetalle: true }] };
}

type GET = (req: NextRequest) => Promise<Response>;

/** Envuelve el GET de una ruta. `ajustar` recalcula lo que no se puede sumar (porcentajes, días…). */
export function conConsolidado(get: GET, ajustar?: (json: Record<string, unknown>, partes: Record<string, unknown>[]) => Record<string, unknown>): GET {
  return async (req: NextRequest) => {
    if (req.nextUrl.searchParams.get("agencia") !== CONSOLIDADO) return get(req);
    const partes: Record<string, unknown>[] = [];
    const incluidas: string[] = [];
    const faltantes: { agencia: string; motivo: string }[] = [];
    const respuestas = await Promise.all(AGENCIAS_CONSOLIDADO.map(async (agencia) => {
      const url = new URL(req.nextUrl.toString());
      url.searchParams.set("agencia", agencia);
      try {
        const r = await get(new NextRequest(url, { headers: req.headers }));
        const j = (await r.json()) as Record<string, unknown>;
        return { agencia, ok: r.ok && !j.error, j };
      } catch (e) {
        return { agencia, ok: false, j: { error: e instanceof Error ? e.message : "error" } as Record<string, unknown> };
      }
    }));
    for (const r of respuestas) {
      if (r.ok) { partes.push(r.j); incluidas.push(r.agencia); }
      else faltantes.push({ agencia: r.agencia, motivo: String(r.j.error ?? "sin datos") });
    }
    if (!partes.length) return NextResponse.json({ error: "Ninguna agencia tiene datos para consolidar.", consolidado: { incluidas, faltantes } }, { status: 400 });
    let suma = partes.slice(1).reduce((t, p) => sumarJSON(t, p) as Record<string, unknown>, partes[0]);
    if (ajustar) suma = ajustar(suma, partes);
    return NextResponse.json({ ...suma, consolidado: { incluidas, faltantes } });
  };
}
