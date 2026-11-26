/**
 * Montos de los 12 meses a partir de la base histórica de una cuenta (base_historica_gastos):
 * total del año = base de los últimos 12 meses × (1 + crecimiento %); reparto según el patrón histórico o parejo.
 */
export function calcularMontosMensuales(baseTtm: number, pesosJson: string | null, pct: number, reparto: "estacional" | "parejo"): number[] {
  const total = baseTtm * (1 + pct / 100);
  if (reparto === "parejo" || !pesosJson) return Array(12).fill(Math.round(total / 12));
  try {
    const pesos: number[] = JSON.parse(pesosJson);
    if (!Array.isArray(pesos) || pesos.length !== 12) throw new Error("formato inválido");
    return pesos.map((p) => Math.round(total * p));
  } catch {
    return Array(12).fill(Math.round(total / 12));
  }
}
