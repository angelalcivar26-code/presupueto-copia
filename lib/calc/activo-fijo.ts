/**
 * Motor de calculo puro - ACTIVO FIJO (cuenta 18)
 *
 * Replica Agencia_Modelo filas 159-194 (Matriz).
 *
 * CORRECCION DE HOY (fecha anterior): la depreciacion mensual de cada
 * categoria tiene un TOPE — nunca puede exceder el valor neto en libros
 * restante. Sin este tope, "Unidades de Transporte" (ya depreciado en
 * 99.997%) se iba a valor neto NEGATIVO. Con el tope, enero se lleva el
 * remanente y el resto del año queda en $0.
 *
 * CORRECCION DE HOY (esta sesion): calcularTerrenos ahora devuelve tambien
 * costo_inicio_mes y adquisicion_del_mes (antes solo costo_fin_mes), para
 * que la pantalla pueda mostrar "Costo al inicio del mes" igual que las
 * demas categorias -- Terrenos sigue sin fila de depreciacion ni Valor neto
 * en libros porque no se deprecia.
 *
 * REGISTRO BIEN POR BIEN (sep-2026): si la agencia tiene cargado el reporte
 * de activos fijos de la contadora (tabla activos_fijos), la depreciacion de
 * los bienes existentes sale de ese registro, bien por bien, con la cuota
 * real de cada uno (incluye el edificio revaluado y los bienes que terminan
 * de depreciarse durante el anio). El saldo inicial de costo y depreciacion
 * acumulada sigue saliendo de saldos_iniciales, para que el Balance cuadre.
 */

interface CategoriaActivoFijoConfig {
  codigo: string;
  nombre: string;
  tasa_anual: number;
  costo_inicial: number;
  depreciacion_acumulada_inicial: number; // negativo
}

interface ResultadoMesActivoFijoCategoria {
  mes: number;
  costo_inicio_mes: number;
  adquisicion_del_mes: number;
  costo_fin_mes: number;
  depreciacion_acumulada_inicio_mes: number; // negativo
  depreciacion_del_mes: number; // negativo, ya con el tope aplicado
  depreciacion_acumulada: number; // negativo, fin de mes (= inicio + del mes)
  valor_neto_en_libros: number; // nunca negativo
}

/**
 * depreciacionRegistroPorMes (opcional): depreciación de los bienes que YA
 * existen, calculada bien por bien desde el registro de la contadora (ver
 * depreciacionRegistroPorCategoria, más abajo). Montos positivos, 12 meses.
 *
 *  - Sin registro (agencia que todavía no lo sube): bienes existentes = costo
 *    del corte × factor ÷ 12 hasta agotar su valor neto; compras nuevas =
 *    su costo × factor ÷ 12 hasta agotar el suyo (cada parte por separado).
 *  - Con registro: depreciación del mes = cuota de los bienes existentes
 *    (del registro) + compras nuevas del plan × factor ÷ 12. Las compras
 *    empiezan a depreciarse el mes siguiente al de la compra, igual que antes.
 *
 * En los dos casos se mantiene el TOPE: nunca se deprecia más que el valor
 * neto en libros que queda.
 */
export function calcularActivoFijoCategoria(
  config: CategoriaActivoFijoConfig,
  adquisicionesPorMes: number[],
  depreciacionRegistroPorMes?: number[]
): ResultadoMesActivoFijoCategoria[] {
  const resultados: ResultadoMesActivoFijoCategoria[] = [];
  let costoInicioMes = config.costo_inicial;
  let depreciacionAcumulada = config.depreciacion_acumulada_inicial;
  // Sin registro, los bienes existentes y las compras nuevas se deprecian por separado, cada parte
  // hasta su propio valor neto: antes la tasa se aplicaba al costo histórico total (incluidos bienes
  // ya depreciados) y esa depreciación se comía el valor de las compras nuevas.
  let netoExistentes = Math.max(0, config.costo_inicial + config.depreciacion_acumulada_inicial);
  let depNuevas = 0;

  for (let i = 0; i < 12; i++) {
    const mes = i + 1;
    const adquisicion = adquisicionesPorMes[i] ?? 0;
    const depreciacionAcumuladaInicioMes = depreciacionAcumulada;
    const costoNuevas = costoInicioMes - config.costo_inicial;

    let depreciacionLineaRecta: number;
    if (depreciacionRegistroPorMes) {
      depreciacionLineaRecta = -((depreciacionRegistroPorMes[i] ?? 0) + (costoNuevas * config.tasa_anual) / 12);
    } else {
      const deExistentes = Math.min((config.costo_inicial * config.tasa_anual) / 12, netoExistentes);
      const deNuevas = Math.min((costoNuevas * config.tasa_anual) / 12, Math.max(0, costoNuevas - depNuevas));
      netoExistentes -= deExistentes;
      depNuevas += deNuevas;
      depreciacionLineaRecta = -(deExistentes + deNuevas);
    }
    const valorNetoAntesDelMes = costoInicioMes + depreciacionAcumulada;

    const depreciacionDelMes =
      valorNetoAntesDelMes <= 0 ? 0 : Math.max(depreciacionLineaRecta, -valorNetoAntesDelMes);

    depreciacionAcumulada += depreciacionDelMes;
    const costoFinMes = costoInicioMes + adquisicion;
    const valorNetoEnLibros = Math.max(0, costoFinMes + depreciacionAcumulada);

    resultados.push({
      mes,
      costo_inicio_mes: costoInicioMes,
      adquisicion_del_mes: adquisicion,
      costo_fin_mes: costoFinMes,
      depreciacion_acumulada_inicio_mes: depreciacionAcumuladaInicioMes,
      depreciacion_del_mes: depreciacionDelMes,
      depreciacion_acumulada: depreciacionAcumulada,
      valor_neto_en_libros: valorNetoEnLibros,
    });

    costoInicioMes = costoFinMes;
  }

  return resultados;
}

interface ResultadoMesTerrenos {
  mes: number;
  costo_inicio_mes: number;
  adquisicion_del_mes: number;
  costo_fin_mes: number;
}

/** Terrenos no se deprecia -- solo acumula costo. Se deja "Costo al inicio
 *  del mes" explicito (antes no existia) para que se vea igual que las
 *  demas categorias, sin fila de depreciacion ni valor neto en libros. */
export function calcularTerrenos(
  costoInicial: number,
  adquisicionesPorMes: number[]
): ResultadoMesTerrenos[] {
  const resultados: ResultadoMesTerrenos[] = [];
  let costoInicioMes = costoInicial;
  for (let i = 0; i < 12; i++) {
    const adquisicion = adquisicionesPorMes[i] ?? 0;
    const costoFinMes = costoInicioMes + adquisicion;
    resultados.push({
      mes: i + 1,
      costo_inicio_mes: costoInicioMes,
      adquisicion_del_mes: adquisicion,
      costo_fin_mes: costoFinMes,
    });
    costoInicioMes = costoFinMes;
  }
  return resultados;
}

export const CATEGORIAS_ACTIVO_FIJO_MATRIZ: CategoriaActivoFijoConfig[] = [
  { codigo: "1802", nombre: "Edificios", tasa_anual: 0.05, costo_inicial: 2874410.23, depreciacion_acumulada_inicial: -2174383.47 },
  { codigo: "1803", nombre: "Muebles de oficina", tasa_anual: 0.1, costo_inicial: 165686, depreciacion_acumulada_inicial: -115597.69 },
  { codigo: "1804", nombre: "Equipo de oficina", tasa_anual: 0.1, costo_inicial: 110890, depreciacion_acumulada_inicial: -77489.11 },
  { codigo: "1805", nombre: "Enseres de Oficina", tasa_anual: 0.1, costo_inicial: 114119, depreciacion_acumulada_inicial: -82261.42 },
  { codigo: "1806", nombre: "Equipos de Computación", tasa_anual: 0.33, costo_inicial: 440874, depreciacion_acumulada_inicial: -337391.93 },
  { codigo: "1807", nombre: "Unidades de Transporte", tasa_anual: 0.2, costo_inicial: 87641, depreciacion_acumulada_inicial: -87638.19 },
  { codigo: "1890", nombre: "Otros Activos", tasa_anual: 0.1, costo_inicial: 86890.36, depreciacion_acumulada_inicial: -50696.32 },
];
// ─────────────────────────────────────────────────────────────────────────
// Registro de activos fijos bien por bien (reporte de la contadora)
// ─────────────────────────────────────────────────────────────────────────

/** Lo mínimo que el motor necesita de cada bien (tabla activos_fijos). */
export interface BienRegistroActivoFijo {
  categoria: string;
  valor_contable: number;  // costo actual en libros (incluye revalúos, ej. edificio de Matriz)
  valor_historico: number;
  valor_residual: number;
  vida_util_meses: number;
  dep_acumulada: number; // positivo, a la fecha de corte
  dep_mensual: number;   // cuota del reporte; 0 si el bien se activó en el mes del corte
}

/** Lo que le falta depreciar al bien a la fecha de corte: valor en libros
 *  (costo contable - depreciación acumulada) menos su valor residual. Se usa
 *  el costo CONTABLE y no el histórico porque en un bien revaluado la
 *  depreciación acumulada ya supera al costo histórico. */
function restantePorDepreciar(b: BienRegistroActivoFijo): number {
  return Math.max(0, b.valor_contable - Math.abs(b.dep_acumulada) - b.valor_residual);
}

/** Cuota mensual de un bien: la del reporte o, si viene en 0 (bien recién
 *  activado en el mes del corte), (costo - residual) ÷ vida útil en meses. */
function cuotaMensualBien(b: BienRegistroActivoFijo): number {
  if (b.dep_mensual > 0) return b.dep_mensual;
  const base = Math.max(0, b.valor_contable - b.valor_residual);
  return b.vida_util_meses > 0 ? base / b.vida_util_meses : 0;
}

/** Meses que se avanzan entre el corte y enero del ejercicio: 0.
 *  Criterio de la herramienta (todos los módulos igual): el balance del corte es el punto de partida
 *  de enero, aunque el corte sea de octubre; no se proyectan los meses intermedios. Cuando se cargue
 *  diciembre, corte e inicio del año coinciden. */
function mesesHastaInicioEjercicio(_fechaCorte: string, _ejercicio: number): number {
  void _fechaCorte; void _ejercicio;
  return 0;
}

/**
 * Depreciación de cada mes del ejercicio, por categoría, sumando bien por
 * bien. Cada bien avanza desde su valor en libros al corte con su propia
 * cuota, y se detiene al llegar a su valor residual (el mes en que
 * termina se lleva solo lo que le falta). Terrenos no aparece porque no se
 * deprecia (vida útil 0).
 */
export function depreciacionRegistroPorCategoria(
  bienes: BienRegistroActivoFijo[],
  fechaCorte: string,
  ejercicio: number
): Record<string, number[]> {
  const desplazamiento = mesesHastaInicioEjercicio(fechaCorte, ejercicio);
  const resultado: Record<string, number[]> = {};
  for (const b of bienes) {
    if (!resultado[b.categoria]) resultado[b.categoria] = Array(12).fill(0);
    const restante = restantePorDepreciar(b);
    const cuota = cuotaMensualBien(b);
    if (cuota <= 0 || restante <= 0) continue;
    for (let i = 0; i < 12; i++) {
      const antes = Math.min(cuota * (desplazamiento + i), restante);
      const despues = Math.min(cuota * (desplazamiento + i + 1), restante);
      resultado[b.categoria][i] += despues - antes;
    }
  }
  for (const k of Object.keys(resultado)) resultado[k] = resultado[k].map((v) => Math.round(v * 100) / 100);
  return resultado;
}

/**
 * El registro viaja pegado al objeto de factores de depreciación, así llega
 * al orquestador por el mismo camino que ya usan todos los reportes, sin
 * cambiar la firma de ninguna función ni ningún route.ts. Es una WeakMap: no
 * se guarda nada global entre peticiones ni se mezcla entre agencias.
 */
const registroPorFactores = new WeakMap<object, Record<string, number[]>>();

export function adjuntarDepreciacionRegistro(factores: object, porCategoria: Record<string, number[]>): void {
  registroPorFactores.set(factores, porCategoria);
}

export function depreciacionRegistroDe(factores: object | undefined): Record<string, number[]> | undefined {
  return factores ? registroPorFactores.get(factores) : undefined;
}

/** Situación de un bien dentro del ejercicio (para la pantalla Bienes y los
 *  indicadores de la pantalla Resumen). Montos positivos. */
interface EstadoBienEjercicio {
  cuota: number;
  netoInicio: number;           // valor en libros al 31-dic anterior al ejercicio
  netoFin: number;              // valor en libros al 31-dic del ejercicio
  depEjercicio: number;         // depreciación dentro del ejercicio
  depreciadoAntes: boolean;     // ya llegó a su residual antes de empezar el ejercicio
  mesTerminaEjercicio: number | null; // 0..11 si termina de depreciarse dentro del ejercicio
  termina: string | null;       // "AAAA-MM" en que termina de depreciarse (null si no se deprecia)
}

export function estadoBienEnEjercicio(
  b: BienRegistroActivoFijo,
  fechaCorte: string,
  ejercicio: number
): EstadoBienEjercicio {
  const desp = mesesHastaInicioEjercicio(fechaCorte, ejercicio);
  const netoCorte = Math.max(0, b.valor_contable - Math.abs(b.dep_acumulada));
  const restante = restantePorDepreciar(b);
  const cuota = cuotaMensualBien(b);
  const depHasta = (k: number) => (cuota > 0 ? Math.min(cuota * k, restante) : 0);
  const netoInicio = netoCorte - depHasta(desp);
  const netoFin = netoCorte - depHasta(desp + 12);

  let termina: string | null = null;
  let mesTerminaEjercicio: number | null = null;
  if (cuota > 0) {
    const mesesRestantes = restante > 0 ? Math.ceil(restante / cuota - 1e-9) : 0; // desde el corte
    // Con el corte como punto de partida de enero, el primer mes que se deprecia es enero del ejercicio.
    const total = ejercicio * 12 + (mesesRestantes - 1);
    termina = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    const k = mesesRestantes - desp; // 1..12 si termina dentro del ejercicio
    if (k >= 1 && k <= 12) mesTerminaEjercicio = k - 1;
  }
  return {
    cuota,
    netoInicio,
    netoFin,
    depEjercicio: netoInicio - netoFin,
    // Bienes que ya estaban en su valor residual (ej. los que quedaron en $1) también cuentan como depreciados.
    depreciadoAntes: b.vida_util_meses > 0 && restante - depHasta(desp) <= 0.005,
    mesTerminaEjercicio,
    termina,
  };
}