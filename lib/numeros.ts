/**
 * LECTURA DE MONTOS ESCRITOS POR EL USUARIO — formato Ecuador.
 *
 *   punto = separador de miles   ·   coma = separador decimal
 *
 *   "1500" → 1500        "1.500" → 1500        "1.500,50" → 1500,5
 *   "1500,5" → 1500,5    "0,045" → 0,045       "1,500" → 1,5
 *   "-250" / "(250)" → −250                    "$ 1.500" → 1500
 *
 * Un punto que no separa grupos de tres cifras ("2.5", "1500.75", "1.50.000") es
 * ambiguo y se RECHAZA con mensaje: así "2.5" nunca se guarda como 25.
 * Una sola función para toda la herramienta.
 */

interface LecturaMonto {
  /** El número leído; null si la casilla está vacía o no se pudo leer. */
  valor: number | null;
  /** Mensaje para mostrar junto a la casilla cuando no se pudo leer. */
  error: string | null;
}

const MILES = /^\d{1,3}(\.\d{3})+$/; // 1.500 · 12.345.678
const ENTERO = /^\d+$/;

export function leerMonto(texto: string | number | null | undefined): LecturaMonto {
  if (typeof texto === "number") return Number.isFinite(texto) ? { valor: texto, error: null } : { valor: null, error: "Valor no válido" };
  let t = String(texto ?? "").replace(/[\s$ ]/g, "");
  if (t === "") return { valor: null, error: null };

  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (t.startsWith("-") || t.startsWith("−")) { negativo = !negativo; t = t.slice(1); }
  if (t === "") return { valor: null, error: "Escriba un número" };

  const comas = (t.match(/,/g) ?? []).length;
  if (comas > 1) return { valor: null, error: "Use una sola coma para decimales" };

  const [entera, decimal] = comas ? t.split(",") : [t, ""];
  if (comas && !/^\d*$/.test(decimal)) return { valor: null, error: "Después de la coma solo van cifras" };
  if (comas && decimal === "") return { valor: null, error: "Faltan los decimales después de la coma" };

  let parteEntera: string;
  if (entera === "") parteEntera = "0"; // ",5" → 0,5
  else if (ENTERO.test(entera)) parteEntera = entera;
  else if (MILES.test(entera)) parteEntera = entera.replace(/\./g, "");
  else if (/^[\d.]+$/.test(entera)) {
    // Hay puntos, pero no separan miles: "2.5", "1500.75", "1.50.000"
    const sugerido = !comas && /^\d+\.\d+$/.test(entera) ? ` (por ejemplo ${entera.replace(".", ",")})` : "";
    return { valor: null, error: `Use coma para decimales${sugerido}; el punto solo separa miles` };
  } else return { valor: null, error: "Solo se permiten cifras, punto de miles y coma decimal" };

  const v = Number(`${parteEntera}${comas ? `.${decimal}` : ""}`);
  if (!Number.isFinite(v)) return { valor: null, error: "Valor no válido" };
  return { valor: negativo ? -v : v, error: null };
}

/** Texto para precargar una casilla en formato local, sin separador de miles para que sea fácil de editar ("1500,5"). */
export function textoEditable(v: number | null | undefined, decimales = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  const r = Math.round(v * 10 ** decimales) / 10 ** decimales;
  return String(r).replace(".", ",");
}

/** Lee las 12 casillas de un mes a mes: todos los valores (vacío = 0) o el primer error con su mes. */
const MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function leerMeses(textos: (string | number | null | undefined)[]): { valores: number[]; error: null } | { valores: null; error: string } {
  const valores: number[] = [];
  for (let i = 0; i < textos.length; i++) {
    const r = leerMonto(textos[i]);
    if (r.error) return { valores: null, error: `${textos.length === 12 ? `En ${MESES_NOMBRE[i]}` : `Casilla ${i + 1}`}: ${r.error}.` };
    valores.push(r.valor ?? 0);
  }
  return { valores, error: null };
}

/** Suma de casillas para mostrar un total mientras se edita (lo ilegible cuenta 0). */
export function sumaTextos(textos: string[]): number {
  return textos.reduce((s, t) => s + (leerMonto(t).valor ?? 0), 0);
}
