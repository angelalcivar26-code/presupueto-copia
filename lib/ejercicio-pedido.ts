/**
 * EJERCICIO DEL PEDIDO Y TABLAS POR EJERCICIO.
 *
 * Los parámetros de abajo se guardan por año: el ejercicio base (2027) usa las tablas de siempre y
 * cada ejercicio nuevo tiene su copia (p. ej. parametros_credito_2028), creada al crear el ejercicio.
 * Así editar el 2028 nunca toca el 2027 y corregir el 2027 nunca toca el 2028.
 *
 * El año llega en cada pedido (la pantalla lo agrega; el middleware lo deja en una cabecera) y
 * lib/turso.ts cambia el nombre de la tabla en cada consulta. No agrega lecturas.
 */
export const EJERCICIO_BASE = 2027;
export const CABECERA_EJERCICIO = "x-ejercicio-efectivo";

/**
 * Tablas que pasaron a guardarse por año después de que ya existían ejercicios (nov-2026). Hasta entonces
 * todos los ejercicios compartían la del año base; la primera vez que un ejercicio la usa, recibe una copia
 * de lo que tenía el año base en ese momento (lo mismo que veía hasta ahora), y desde ahí es solo suya.
 */
function TABLAS_AISLADAS_DESPUES_LISTA() {
  return [
    "provision_flow_config", "provision_flow_parametros", // modelo de provisión: castigos, escenario y flow rates
    "planificacion_config", "planificacion_escenarios",   // meta de ROA y escenarios de Planificación
    "notas_reporte",                                      // notas de los anexos impresos
    "estudio_borradores", "respaldos_parametros",         // borradores y copias para Deshacer del Estudio de agencia
  ];
}
export const TABLAS_AISLADAS_DESPUES = new Set(TABLAS_AISLADAS_DESPUES_LISTA());

export const TABLAS_POR_EJERCICIO = [
  "parametros_captaciones", "parametros_credito", "nomina_empleados", "oficiales_credito", "metas_credito_institucional",
  "inversiones", "inversiones_parametros", "activos_diferidos", "factores_depreciacion",
  "parametros_fondos_agencia", "parametros_fondos_institucional",
  "parametros_provision", "parametros_provision_mes", "parametros_produccion",
  ...TABLAS_AISLADAS_DESPUES_LISTA(),
];
const PATRON = new RegExp(`\\b(${TABLAS_POR_EJERCICIO.join("|")})\\b`, "g");

export function tablaDe(tabla: string, ejercicio: number): string {
  return ejercicio === EJERCICIO_BASE ? tabla : `${tabla}_${ejercicio}`;
}

/** Ejercicio del pedido en curso (null fuera de un pedido o si no vino). */
export async function ejercicioDelPedido(): Promise<number | null> {
  try {
    const { headers } = await import("next/headers");
    const n = Number((await headers()).get(CABECERA_EJERCICIO));
    return Number.isInteger(n) && n > 2000 && n < 2100 ? n : null;
  } catch { return null; }
}

/** Tablas aisladas después (ver arriba) que aparecen en la sentencia. */
export function tablasAisladasDespuesEn(sql: string): string[] {
  return [...TABLAS_AISLADAS_DESPUES].filter((t) => new RegExp(`\\b${t}\\b`).test(sql));
}

/** Tablas por ejercicio (nombre base) que aparecen en la sentencia, con o sin el año. */
export function tablasPorEjercicioEn(sql: string): string[] {
  return TABLAS_POR_EJERCICIO.filter((t) => new RegExp(`\\b${t}(?:_\\d{4})?\\b`).test(sql));
}

/** Cambia los nombres de las tablas por las del ejercicio, sin tocar lo que está entre comillas. */
export function sqlDelEjercicio(sql: string, ejercicio: number | null): string {
  if (!ejercicio || ejercicio === EJERCICIO_BASE) return sql;
  // Partes entre comillas simples (textos) se dejan igual.
  return sql.split(/('(?:[^']|'')*')/).map((parte, i) => (i % 2 ? parte : parte.replace(PATRON, (t) => `${t}_${ejercicio}`))).join("");
}

const valido = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n > 2000 && n < 2100 ? n : null;
};

/** Ejercicio del pedido o, si no vino, el año base. Para los valores por defecto de las rutas. */
export async function ejercicioPorDefecto(): Promise<number> {
  return (await ejercicioDelPedido()) ?? EJERCICIO_BASE;
}

/**
 * Ejercicio con el que trabaja una ruta: el que trae el guardado, luego el de la dirección,
 * luego el de la pantalla (cabecera del middleware) y, solo si no vino ninguno, el año base.
 */
export async function ejercicioDe(req: { nextUrl?: URL; url: string }, cuerpo?: { ejercicio?: unknown } | null): Promise<number> {
  const q = (req.nextUrl ?? new URL(req.url)).searchParams.get("ejercicio");
  return valido(cuerpo?.ejercicio) ?? valido(q) ?? (await ejercicioPorDefecto());
}
