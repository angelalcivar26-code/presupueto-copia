/**
 * Motor de cálculo puro - INVERSIONES (cuenta 13)
 *
 * Registro de títulos por agencia. Regla general del presupuesto: cada título se
 * RENUEVA SOLO al vencer, por el mismo número de días, con capital + interés −
 * retención (el "neto a renovar"), y así en cada vencimiento de 2027. Solo sale si
 * se indica "se cancela en" (mes): ese mes el valor vuelve a fondos disponibles.
 *
 *  Interés del día        = capital × tasa ÷ base (360 o 365)
 *  Interés del mes (5103) = suma de los días del mes (devengado, aunque se cobre al vencer)
 *  Al vencer              : interés del período − retención (% sobre el interés) se suma al capital
 *  Retención              : crédito tributario (queda en cuentas por cobrar hasta liquidarlo)
 *
 * Títulos con fecha de inicio posterior al corte = inversiones PLANIFICADAS: se
 * fondean con fondos disponibles (11) desde esa fecha.
 * El año arranca el 1 de enero del ejercicio con el monto registrado (igual que el
 * resto del motor, que arranca desde el balance del corte).
 *
 * Interés ganado ANTES de enero (títulos vigentes): desde el inicio del período en curso
 * hasta el corte ya está en el balance como interés por cobrar (16). Lo de los días entre el
 * corte y el 31 de diciembre (meses que no se proyectan) se reconoce en enero. Al vencer
 * se capitaliza junto con el de 2027 y sale de la 16; no vuelve a pasar por la 5103.
 */

export interface TituloInversion {
  id?: number;
  institucion: string;
  sector: string;               // "Financiero popular y solidario" | "Privado" | "Público"
  cuentaCodigo: string;         // subcuenta de la 13 (catálogo)
  cuentaNombre: string;
  fechaInicio: string;          // AAAA-MM-DD
  fechaFin: string;             // AAAA-MM-DD
  monto: number;
  tasaAnual: number;            // fracción (0.0525)
  cancelaMes: number | null;    // 1..12 del ejercicio, null = se renueva siempre
}

export interface ParametrosInversiones { pctRetencion: number; baseDias: number }

interface ResultadoTitulo extends TituloInversion {
  planificada: boolean;
  dias: number;
  interesMensual: number;
  interesPeriodo: number;
  retencion: number;
  netoRenovar: number;
  capitalPorMes: number[];      // al cierre de cada mes
  interesPorMes: number[];      // devengado en el mes
  renovacionesEnAnio: number;
  interesAntesDeEnero: number;  // devengado del período en curso hasta el 31-dic (ya está en la 16)
  valorCancelado: number;       // capital + interés − retención que vuelve a fondos disponibles al cancelarse (0 si no se cancela)
}

interface ProyeccionInversiones {
  titulos: ResultadoTitulo[];
  capitalPorMes: number[];                                        // saldo 13 (capital) al cierre de cada mes
  porCuenta: Record<string, { nombre: string; valores: number[] }>; // 13 por subcuenta
  interesDevengadoPorMes: number[];                               // 5103
  interesPendientePorMes: number[];                               // devengado aún no capitalizado (por cobrar)
  retencionAcumuladaPorMes: number[];                             // crédito tributario acumulado
  nuevasPorMes: number[];                                         // salen de fondos disponibles
  canceladasPorMes: number[];                                     // vuelven a fondos disponibles
  capitalizadoPorMes: number[];                                   // interés neto sumado al capital en renovaciones
  retencionPorMes: number[];
  capitalAlCorte: number;                                         // suma de títulos vigentes (control contra la 13)
  interesPorCobrarInicial: number;                                // interés ganado antes de enero (ya en la 16 del balance)
  variacion16PorMes: number[];                                    // cambio de la 16 frente al balance: pendiente − inicial + retención
}

const DIA = 86400000;
const aFecha = (s: string) => { const [a, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(a, (m || 1) - 1, d || 1); };

export function proyectarInversiones(titulos: TituloInversion[], p: ParametrosInversiones, ejercicio: number, fechaCorte: string): ProyeccionInversiones {
  const base = p.baseDias === 365 ? 365 : 360;
  const pctRet = Math.max(0, p.pctRetencion);
  const D0 = Date.UTC(ejercicio, 0, 1), D1 = Date.UTC(ejercicio + 1, 0, 1);
  const finMes = Array.from({ length: 12 }, (_, m) => Date.UTC(ejercicio, m + 1, 1)); // primer día del mes siguiente
  const corte = aFecha(fechaCorte);
  const cero = () => Array(12).fill(0) as number[];

  const out: ProyeccionInversiones = {
    titulos: [], capitalPorMes: cero(), porCuenta: {}, interesDevengadoPorMes: cero(), interesPendientePorMes: cero(),
    retencionAcumuladaPorMes: cero(), nuevasPorMes: cero(), canceladasPorMes: cero(), capitalizadoPorMes: cero(),
    retencionPorMes: cero(), capitalAlCorte: 0, interesPorCobrarInicial: 0, variacion16PorMes: cero(),
  };

  for (const t of titulos) {
    const ini = aFecha(t.fechaInicio), fin = aFecha(t.fechaFin);
    const dias = Math.max(1, Math.round((fin - ini) / DIA));
    const plazo = dias * DIA;
    const planificada = ini > corte;
    const interesPeriodo = t.monto * t.tasaAnual * dias / base;
    const r: ResultadoTitulo = {
      ...t, planificada, dias,
      interesMensual: t.monto * t.tasaAnual / 12,
      interesPeriodo, retencion: interesPeriodo * pctRet, netoRenovar: t.monto + interesPeriodo * (1 - pctRet),
      capitalPorMes: cero(), interesPorMes: cero(), renovacionesEnAnio: 0, interesAntesDeEnero: 0, valorCancelado: 0,
    };
    if (!planificada) out.capitalAlCorte += t.monto;

    // Inicio dentro del ejercicio y próximo vencimiento
    let dia = planificada ? Math.max(ini, D0) : D0;
    let proximo = planificada ? dia + plazo : fin;
    while (proximo <= dia) proximo += plazo;
    const hasta = t.cancelaMes ? finMes[Math.min(12, Math.max(1, t.cancelaMes)) - 1] : D1;
    let capital = 0, pendiente = 0, retAcum = 0;
    let inicial = 0, puente = 0;
    const activa = dia < D1 && dia < hasta;
    if (activa && !planificada) {
      capital = t.monto; // vigente: arranca el 1 de enero
      // Interés del período en curso: lo ganado hasta el corte ya está en el balance (16) como interés por cobrar.
      // El corte es el punto de partida de enero: lo que corresponde a los días entre el corte y el 31-dic
      // (meses que no se proyectan) se reconoce en enero, así al vencer el cobro coincide con lo devengado.
      const inicioPeriodo = Math.max(ini, proximo - plazo);
      const hastaCorte = Math.min(D0, Math.max(inicioPeriodo, corte + DIA));
      const diasPrevios = Math.max(0, Math.round((hastaCorte - inicioPeriodo) / DIA));
      const diasPuente = Math.max(0, Math.round((D0 - hastaCorte) / DIA));
      pendiente = capital * t.tasaAnual * diasPrevios / base;
      r.interesAntesDeEnero = pendiente; inicial = pendiente;
      out.interesPorCobrarInicial += pendiente;
      puente = capital * t.tasaAnual * diasPuente / base;
    }
    const cuenta = out.porCuenta[t.cuentaCodigo] ?? (out.porCuenta[t.cuentaCodigo] = { nombre: t.cuentaNombre, valores: cero() });

    for (let m = 0; m < 12; m++) {
      const inicioMes = Date.UTC(ejercicio, m, 1), limite = Math.min(finMes[m], hasta);
      if (activa && planificada && capital === 0 && dia >= inicioMes && dia < finMes[m] && dia < hasta) {
        capital = t.monto; // planificada: se fondea con fondos disponibles en su fecha de inicio
        out.nuevasPorMes[m] += t.monto;
      }
      if (capital > 0) {
        if (m === 0 && puente > 0) { pendiente += puente; r.interesPorMes[0] += puente; }
        for (let d = Math.max(dia, inicioMes); d < limite; d += DIA) {
          const i = capital * t.tasaAnual / base;
          pendiente += i; r.interesPorMes[m] += i;
          if (d + DIA >= proximo && d + DIA <= limite) {
            // Vence: se renueva con capital + interés − retención
            const ret = pendiente * pctRet;
            capital += pendiente - ret; retAcum += ret;
            out.capitalizadoPorMes[m] += pendiente - ret; out.retencionPorMes[m] += ret;
            pendiente = 0; proximo += plazo; r.renovacionesEnAnio++;
          }
        }
        if (t.cancelaMes && m === t.cancelaMes - 1) {
          // Se cancela al cierre del mes: el interés pendiente se liquida y todo vuelve a fondos disponibles
          const ret = pendiente * pctRet;
          retAcum += ret; out.retencionPorMes[m] += ret;
          out.canceladasPorMes[m] += capital + pendiente - ret;
          r.valorCancelado = capital + pendiente - ret;
          capital = 0; pendiente = 0;
        }
      }
      r.capitalPorMes[m] = capital;
      out.capitalPorMes[m] += capital;
      cuenta.valores[m] += capital;
      out.interesDevengadoPorMes[m] += r.interesPorMes[m];
      out.interesPendientePorMes[m] += pendiente;
      out.retencionAcumuladaPorMes[m] += retAcum;
      out.variacion16PorMes[m] += pendiente - inicial + retAcum;
    }
    out.titulos.push(r);
  }
  return out;
}

/** La proyección viaja pegada a los saldos (igual que la provisión) para llegar al Balance sin cambiar firmas. */
const porSaldos = new WeakMap<object, ProyeccionInversiones>();
export function adjuntarInversiones(saldos: object, p: ProyeccionInversiones): void { porSaldos.set(saldos, p); }
export function inversionesDe(saldos: object): ProyeccionInversiones | null { return porSaldos.get(saldos) ?? null; }