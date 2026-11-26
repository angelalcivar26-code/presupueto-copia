/**
 * Motor de cálculo puro - PRODUCCIÓN DE CRÉDITO (número de operaciones)
 *
 * Informativo: no cambia ningún saldo. Se calcula con los mismos datos que
 * ya usa la cartera, así que se mueve solo cuando cambian las metas, los
 * asesores, el % de colocación de la línea o el % de recuperación.
 *
 *  Operaciones a conceder  = asesores activos × mínimo de operaciones por asesor × % de colocación de la línea
 *  Monto promedio          = préstamos a conceder ÷ operaciones a conceder (sale de la meta, no se escribe)
 *  Operaciones iniciales   = enero: dato del sistema al corte (editable) · luego: créditos al fin del mes anterior
 *  Créditos cancelados     = operaciones iniciales × % de recuperación del período
 *  Créditos al fin         = iniciales + a conceder − cancelados
 *  Oficiales requeridos    = créditos al fin ÷ créditos que administra un oficial (editable)
 *  % crecimiento acumulado = saldo final por vencer del mes ÷ saldo inicial por vencer de enero − 1
 */

interface EntradaProduccionLinea {
  asesoresActivos: number;
  minimoOperacionesPorAsesor: number;
  pctDistribucionPorMes: number[];     // 12, fracción
  pctRecuperacionPorMes: number[];     // 12, fracción
  prestamosAConcederPorMes: number[];  // 12, $
  saldoFinalPorVencerPorMes: number[]; // 12, $
  saldoInicialPorVencerEnero: number;
  operacionesIniciales: number;        // editable (0 = sin dato)
  creditosPorOficial: number;          // editable (0 = sin dato)
}

interface ProduccionMes {
  mes: number;
  operacionesIniciales: number;
  operacionesAConceder: number;
  creditosCancelados: number;
  creditosAlFin: number;
  oficialesRequeridos: number | null;  // null si no hay créditos por oficial
  montoPromedio: number | null;        // null si no hay operaciones
  pctCrecimientoAcumulado: number | null;
}

export function calcularProduccionLinea(e: EntradaProduccionLinea): ProduccionMes[] {
  const out: ProduccionMes[] = [];
  let iniciales = e.operacionesIniciales;
  for (let i = 0; i < 12; i++) {
    const aConceder = e.asesoresActivos * e.minimoOperacionesPorAsesor * (e.pctDistribucionPorMes[i] ?? 0);
    const cancelados = iniciales * (e.pctRecuperacionPorMes[i] ?? 0);
    const alFin = iniciales + aConceder - cancelados;
    out.push({
      mes: i + 1,
      operacionesIniciales: iniciales,
      operacionesAConceder: aConceder,
      creditosCancelados: cancelados,
      creditosAlFin: alFin,
      oficialesRequeridos: e.creditosPorOficial > 0 ? alFin / e.creditosPorOficial : null,
      montoPromedio: aConceder > 0 ? (e.prestamosAConcederPorMes[i] ?? 0) / aConceder : null,
      pctCrecimientoAcumulado: e.saldoInicialPorVencerEnero > 0 ? (e.saldoFinalPorVencerPorMes[i] ?? 0) / e.saldoInicialPorVencerEnero - 1 : null,
    });
    iniciales = alFin;
  }
  return out;
}