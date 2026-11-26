/**
 * NIVELES DEL PLAN DE CUENTAS (1 · 2 · 4 · 6 · 8 dígitos, y más si los hubiera).
 *
 * Los archivos del sistema contable traen todos los niveles con sus totales. Si alguno faltara, el cálculo
 * leería cero en esa cuenta de grupo: completarPadres() agrega los niveles que no vinieron, sumando las
 * cuentas de último nivel que cuelgan de cada uno. Nunca cambia un total que sí vino en el archivo.
 */
export const NIVELES = [1, 2, 4, 6, 8, 10, 12];

/** Códigos de los niveles superiores de una cuenta: 14020505 → 1, 14, 1402, 140205. */
export function ancestros(codigo: string): string[] {
  return NIVELES.filter((l) => l < codigo.length).map((l) => codigo.slice(0, l));
}

export function completarPadres(cuentas: Record<string, number>): { cuentas: Record<string, number>; agregadas: string[] } {
  const cods = Object.keys(cuentas).filter((k) => /^\d+$/.test(k));
  const hojas = cods.filter((k) => !cods.some((o) => o !== k && o.startsWith(k)));
  const faltan: Record<string, number> = {};
  for (const h of hojas) for (const a of ancestros(h)) if (!(a in cuentas)) faltan[a] = (faltan[a] ?? 0) + (Number(cuentas[h]) || 0);
  return { cuentas: { ...cuentas, ...faltan }, agregadas: Object.keys(faltan) };
}
