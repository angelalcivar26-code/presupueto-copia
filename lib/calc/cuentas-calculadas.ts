/**
 * Cuentas que calcula la herramienta: lo cargado a mano en ellas no se usa (se reemplaza por el cálculo).
 * Devuelve dónde se calcula, o null si la cuenta se toma de lo cargado en el presupuesto.
 */
export function cuentaCalculada(codigo: string): string | null {
  const c = codigo.replace(/\D/g, "");
  if (c.startsWith("410590")) return "Intereses por préstamos internos: préstamos recibidos de otras oficinas (2908) × tasa interna (Proyección de ingresos → 5190)";
  if (c.startsWith("41")) return "Intereses causados: los calcula Obligaciones con el público";
  if (c.startsWith("44")) return "Provisiones: las calcula Cartera (modelo de provisión)";
  if (c.startsWith("4505")) return "Depreciaciones: las calcula Activos fijos";
  if (c.startsWith("4506")) return "Amortizaciones: salen de Gastos y pagos anticipados (Otros activos)";
  if (c.startsWith("450705")) return "Suministros: salen de Materiales (1906, Otros activos)";
  if (c.startsWith("450415")) return "Aportes a la SEPS: 0,45 por mil semestral sobre activos + 1 % sobre excedentes (Gastos operacionales, 4504)";
  if (c.startsWith("450420") || c.startsWith("450421")) return "COSEDE: saldo promedio de 21 × prima (Gastos operacionales, 4504)";
  if (c.startsWith("5104")) return "Intereses de cartera: los calcula Cartera";
  return null;
}
