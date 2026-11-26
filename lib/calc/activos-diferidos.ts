/**
 * GASTOS ANTICIPADOS (1904), GASTOS DIFERIDOS (1905) Y MATERIALES (1906): registro de partidas.
 *
 * Cada partida (póliza de seguro, licencia, adecuación, compra de materiales…) tiene fecha de inicio y de fin, monto y
 * alcance: de una agencia o de toda la cooperativa (cada agencia lleva su parte según su % de activo).
 *  - Pago: el monto sale de fondos disponibles en la fecha de inicio. Las que empiezan entre el corte y diciembre
 *    (meses que el presupuesto no proyecta) se pagan en enero.
 *  - Gasto: como lo lleva contabilidad, en cuotas mensuales iguales: monto ÷ número de meses, desde el mes siguiente al
 *    inicio hasta el mes de fin (póliza del 15/01/26 al 15/01/27 → 12 cuotas, de feb-26 a ene-27).
 *  - Renovación: al vencer, si se renueva, empieza otro período del mismo plazo en meses con el monto × (1 + incremento).
 *  - Partidas de toda la cooperativa: el período vigente se reparte con el % de activo con que se contrató (el del último
 *    corte o el anterior, de dic-2025); las renovaciones, siempre con el del último corte.
 *  - Saldo del mes = saldo del balance al corte + pagos − gasto del año (el presupuesto parte del corte).
 */

export type GrupoDiferido = "1904" | "1905" | "1906";
/** Parámetro (otros_pasivo_parametros): variación mensual de los anticipos a terceros (190410); + sube el saldo (sale de caja). */
export const CONCEPTO_ANTICIPOS = "anticipos_terceros_variacion";
export const GRUPOS_DIFERIDOS: GrupoDiferido[] = ["1904", "1905", "1906"];

export interface PartidaDiferida {
  id: number;
  grupo: GrupoDiferido;
  descripcion: string;
  proveedor: string;
  cuentaActivo: string;
  cuentaGasto: string;
  fechaInicio: string;   // AAAA-MM-DD
  fechaFin: string;      // AAAA-MM-DD (incluida)
  monto: number;
  /** "agencia" = de una sola; "cooperativa" = repartida por % de activo; "reparto" = repartida por cantidades (licencias por agencia). */
  alcance: "agencia" | "cooperativa" | "reparto";
  agencia: string | null; // la dueña si el alcance es "agencia"
  /** Solo "reparto": cantidad de cada agencia (la parte de cada una = su cantidad ÷ el total). */
  reparto?: Record<string, number>;
  renueva: boolean;
  incremento: number;    // fracción (0,05 = 5 %)
  /** % de activo del período vigente (toda la cooperativa): "corte" = último corte; "anterior" = dic-2025. Las renovaciones usan el del corte. */
  pctBase?: "corte" | "anterior";
  /** Cuotas mensuales en que se paga cada período (1 = de contado). La póliza entra completa al activo contra cuentas por
   *  pagar (2506, pago a proveedores); la cuota inicial se paga al empezar y las demás, una por mes. */
  cuotasPago?: number;
  /** Meses del año en que se paga cada período (1 = enero … 12 = diciembre), en partes iguales; vacío = de contado.
   *  Cada mes se toma en su primera vez desde el inicio del período (póliza del 16/01 con ene–abr: ene, feb, mar y abr). */
  mesesPago?: number[];
  /** Descripción completa (la de contabilidad); `descripcion` es el nombre corto que se ve en la tabla. */
  detalle?: string;
  /** "archivo" = cargada del reporte de amortización (se reemplaza al subir otro); "manual" = registrada en la herramienta. */
  origen?: "archivo" | "manual";
}

export interface PartidaCalc extends PartidaDiferida {
  parte: number;            // 1 (de la agencia) o su % de activo (de toda la cooperativa) en el período vigente
  parteRenov: number;       // el de las renovaciones (último corte)
  dias: number;
  meses: number;            // cuotas mensuales de amortización
  gastoPorMes: number[];    // del año, ya con la parte de la agencia
  pagosPorMes: number[];    // lo que entra al activo (la póliza completa al contratarla o renovarla)
  deudaAltaPorMes: number[];  // parte financiada que queda en cuentas por pagar (25)
  deudaPagoPorMes: number[];  // cuotas financiadas que se pagan en el mes (bajan la 25, salen de caja)
  pendienteCorte: number;   // lo que falta devengar al corte (para el cuadre con el balance)
  vigenteAlCorte: boolean;
  vence: string | null;     // fin del último período que toca el año (o null si sigue vigente)
  renovacionesEnAnio: number;
}

export interface GrupoCalc {
  saldoCorte: number;       // balance al corte
  registradoCorte: number;  // lo que explican las partidas al corte
  pagosPorMes: number[];      // entra al activo
  deudaAltaPorMes: number[];  // queda por pagar (25)
  deudaPagoPorMes: number[];  // cuotas pagadas de lo que quedó por pagar
  gastoPorMes: number[];
  saldoPorMes: number[];
  gastoPorCuenta: Record<string, number[]>;
  partidas: number;
  /** Solo 1904: anticipos a terceros (190410), que no tienen partidas: saldo al corte ± variación mensual (parámetro).
   *  El resto de la 1904 (190490 otros gastos anticipados) es lo de las pólizas. saldoPorMes del grupo ya incluye ambos. */
  anticipos?: { saldoCorte: number; variacionPorMes: number[]; saldoPorMes: number[] };
  /** Solo 1906: plan mensual de cada agencia (compras que entran a la 1906 y consumo que va a 450705), además de las compras registradas. */
  plan?: PlanMateriales;
}

/**
 * Materiales (1906). La proveeduría se compra en Matriz (bodega); cada agencia le pide a Matriz y su 1906 sube sin salir
 * efectivo (contra transferencias internas 2908); lo que la agencia usa de su stock baja la 1906 y va al gasto 450705.
 * Todo se registra a mano (nada viene lleno; el promedio histórico solo se sugiere en el formulario):
 *  - Pedido (agencia): incremento de su 1906. En Matriz es la compra de proveeduría (sale de caja).
 *  - Gasto: disminución de la 1906 contra 450705.
 *  - Matriz además entrega a las agencias lo que piden (baja su 1906 contra transferencias internas 1908, sin efectivo).
 * Saldo del mes = saldo anterior + pedidos (o compras) − entregas − gasto.
 */
export const CONCEPTO_MAT_COMPRAS = "materiales_compras_mes";
export const CONCEPTO_MAT_CONSUMO = "materiales_consumo_mes";
export interface PlanMateriales {
  esBodega: boolean;
  compras: number[];     // Matriz: compras de proveeduría (efectivo)
  pedidos: number[];     // agencia: lo que pide a Matriz
  entregas: number[];    // Matriz: lo que entrega a las agencias
  consumo: number[];     // gasto 450705
  saldoCorte: number;
  saldoPorMes: number[];
  /** Promedio mensual histórico (solo de referencia en el formulario): pedido (en Matriz, compra) y gasto. */
  promedioPedido: number; promedioGasto: number; periodo: string | null;
}
/** Valor de cada mes del ejercicio de un pedido o gasto registrado (el monto se reparte por igual entre sus meses). */
export function mesesPedido(fechaInicio: string, fechaFin: string, monto: number, ejercicio: number): number[] {
  const v = Array(12).fill(0) as number[];
  const a = Number(fechaInicio.slice(0, 4)) * 12 + Number(fechaInicio.slice(5, 7)) - 1;
  const b = Math.max(a, Number(fechaFin.slice(0, 4)) * 12 + Number(fechaFin.slice(5, 7)) - 1);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(monto > 0)) return v;
  const c = monto / (b - a + 1);
  for (let m = a; m <= b; m++) if (m - ejercicio * 12 >= 0 && m - ejercicio * 12 < 12) v[m - ejercicio * 12] += c;
  return v;
}
/** Suma el plan a la proyección de la 1906: entradas (compras + pedidos − entregas), gasto 450705 y saldo. */
export function agregarPlanMateriales(p: ProyeccionDiferidos, plan: PlanMateriales) {
  const g = p.grupos["1906"];
  g.pagosPorMes = g.pagosPorMes.map((v, i) => v + plan.compras[i] + plan.pedidos[i] - plan.entregas[i]);
  g.gastoPorMes = g.gastoPorMes.map((v, i) => v + plan.consumo[i]);
  const k = Object.keys(g.gastoPorCuenta).find((c) => c.startsWith("450705")) ?? "450705";
  g.gastoPorCuenta[k] = (g.gastoPorCuenta[k] ?? Array(12).fill(0)).map((v, i) => v + plan.consumo[i]);
  let s = g.saldoCorte;
  g.saldoPorMes = g.pagosPorMes.map((v, i) => (s = s + v - g.gastoPorMes[i]));
  g.plan = plan;
}

interface ProyeccionDiferidos { ejercicio: number; fechaCorte: string; grupos: Record<GrupoDiferido, GrupoCalc>; partidas: PartidaCalc[]; nombres?: Record<string, string> }

const DIA = 86400000;
const t = (f: string) => Date.parse(`${f}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cero = () => Array(12).fill(0) as number[];
/** Mes como número (año × 12 + mes). */
const mi = (ms: number) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
/** La misma fecha n meses después (si el mes no tiene ese día, el último día del mes). */
function sumarMeses(ms: number, n: number): number {
  const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth() + n, dia = d.getUTCDate();
  const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(dia, ult));
}
/** Meses en que se amortiza un período: del mes siguiente al inicio al mes de fin (al menos uno). */
export function mesesAmortizacion(a: number, b: number): { desde: number; hasta: number; n: number } {
  const hasta = mi(b), desde = Math.min(mi(a) + 1, hasta);
  return { desde, hasta, n: hasta - desde + 1 };
}

/** Proyección del año de las partidas de una agencia (parte = 1 o su % de activo). */
export function proyectarDiferidos(
  partidas: (PartidaDiferida & { parte: number; parteRenov?: number })[],
  ejercicio: number,
  fechaCorte: string,
  saldosCorte: Partial<Record<GrupoDiferido, number>>,
  nombres: Record<string, string> = {},
  /** 1904 · anticipos a terceros (190410): saldo al corte (null = lo que no explican las pólizas) y variación de cada mes. */
  anticipos?: { saldoCorte: number | null; variacionPorMes: number[] },
): ProyeccionDiferidos {
  const ini = Date.UTC(ejercicio, 0, 1), fin = Date.UTC(ejercicio, 11, 31), corte = t(fechaCorte);
  const m0 = ejercicio * 12, mCorte = mi(corte);
  const calc: PartidaCalc[] = [];
  for (const p of partidas) {
    const a0 = t(p.fechaInicio), b0 = t(p.fechaFin);
    if (!Number.isFinite(a0) || !Number.isFinite(b0) || b0 < a0 || !(p.monto > 0)) continue;
    if (p.grupo === "1906") continue; // materiales: son pedidos a Matriz, van en el plan (agregarPlanMateriales)
    const D = Math.round((b0 - a0) / DIA) + 1;
    const gasto = cero(), pagos = cero(), dAlta = cero(), dPago = cero();
    // meses de pago de un período que empieza en a (número absoluto de mes); de contado = solo el mes de inicio
    const mesesDePago = (a: number): number[] => {
      const s0 = mi(a), m = s0 % 12;
      if (p.mesesPago?.length) return [...new Set(p.mesesPago.map((x) => s0 + ((Math.round(x) - 1 - m + 12) % 12)))].sort((x, y) => x - y);
      const n = Math.max(1, Math.round(p.cuotasPago || 1));
      return Array.from({ length: n }, (_, j) => s0 + j);
    };
    let pendiente = 0, vigente = false, vence: string | null = null, renov = 0;
    let a = a0, b = b0, monto = p.monto;
    const pRenov = p.parteRenov ?? p.parte;
    const plazoMeses = Math.max(1, mi(b0) - mi(a0));
    for (let k = 0; k < 50; k++) {
      const parte = k === 0 ? p.parte : pRenov;
      // cuotas mensuales iguales
      const am = mesesAmortizacion(a, b), cuota = monto * parte / am.n;
      // pago del período. Los que empiezan entre el corte y diciembre (meses que no se proyectan) entran en enero por lo que
      // les queda por amortizar desde enero: las cuotas de esos meses puente ya se habrían gastado
      if (a > corte && a <= fin) {
        const mA = a < ini ? 0 : new Date(a).getUTCMonth();
        const alta = a < ini ? cuota * Math.max(0, am.hasta - Math.max(am.desde, m0) + 1) : monto * parte;
        pagos[mA] += alta;
        // pago en cuotas: la cuota inicial al empezar, las demás una por mes; lo que falta queda en cuentas por pagar
        const mesesPago = mesesDePago(a);
        if (alta > 0 && (mesesPago.length > 1 || mesesPago[0] !== mi(a))) {
          const cp = monto * parte / mesesPago.length;
          const porPagar = a < ini ? mesesPago.filter((x) => x >= m0) : mesesPago.filter((x) => x > mi(a));
          const total = porPagar.length * cp, L = Math.min(alta, total), f = total > 0 ? L / total : 0;
          dAlta[mA] += L;
          for (const x of porPagar) if (x - m0 >= 0 && x - m0 < 12) dPago[x - m0] += cp * f;
        }
      }
      // pendiente de amortizar al corte: las cuotas de los meses posteriores al corte
      if (a <= corte && am.hasta > mCorte) { pendiente += cuota * (am.hasta - Math.max(am.desde - 1, mCorte)); vigente = true; }
      for (let m = 0; m < 12; m++) if (m0 + m >= am.desde && m0 + m <= am.hasta) gasto[m] += cuota;
      // El corte es el punto de partida de enero: las cuotas de los meses entre el corte y diciembre
      // (que no se proyectan) siguen en el saldo del corte y se amortizan en enero.
      if (a <= corte) {
        const puente = Math.max(0, Math.min(am.hasta, m0 - 1) - Math.max(am.desde, mCorte + 1) + 1);
        if (puente > 0) gasto[0] += cuota * puente;
      }
      if (b >= ini && b <= fin) vence = iso(b);
      if (!p.renueva || b >= fin) break;
      // siguiente período, igual de largo
      // siguiente período: empieza al día siguiente y dura los mismos meses de calendario (15/01/27 → 15/01/28)
      a = b + DIA; b = sumarMeses(b, plazoMeses); monto = monto * (1 + (p.incremento || 0));
      if (a <= fin && a >= ini) renov++;
    }
    if (p.renueva && vence && t(vence) < fin) vence = null; // se renovó: sigue vigente en diciembre
    calc.push({ ...p, parteRenov: pRenov, dias: D, meses: mesesAmortizacion(a0, b0).n, gastoPorMes: gasto, pagosPorMes: pagos, deudaAltaPorMes: dAlta, deudaPagoPorMes: dPago, pendienteCorte: pendiente, vigenteAlCorte: vigente, vence, renovacionesEnAnio: renov });
  }
  const grupos = Object.fromEntries(GRUPOS_DIFERIDOS.map((g) => {
    const ps = calc.filter((x) => x.grupo === g);
    const pagos = cero(), gasto = cero(), dA = cero(), dP = cero(), porCuenta: Record<string, number[]> = {};
    for (const x of ps) for (let m = 0; m < 12; m++) {
      pagos[m] += x.pagosPorMes[m]; gasto[m] += x.gastoPorMes[m]; dA[m] += x.deudaAltaPorMes[m]; dP[m] += x.deudaPagoPorMes[m];
      (porCuenta[x.cuentaGasto] ??= cero())[m] += x.gastoPorMes[m];
    }
    const s0 = saldosCorte[g] ?? 0;
    const registrado = ps.reduce((a, x) => a + x.pendienteCorte, 0);
    // 1904: los anticipos a terceros se mueven con su variación mensual (sin partidas)
    const ant = g === "1904" && anticipos ? (() => {
      const ini = anticipos.saldoCorte ?? Math.max(0, s0 - registrado);
      const vari = Array.from({ length: 12 }, (_, m) => Number(anticipos.variacionPorMes[m]) || 0);
      let a = ini;
      return { saldoCorte: ini, variacionPorMes: vari, saldoPorMes: vari.map((v) => (a = a + v)) };
    })() : undefined;
    let s = s0;
    const saldo = pagos.map((v, m) => (s = s + v - gasto[m] + (ant?.variacionPorMes[m] ?? 0)));
    return [g, { saldoCorte: s0, registradoCorte: registrado, pagosPorMes: pagos, deudaAltaPorMes: dA, deudaPagoPorMes: dP, gastoPorMes: gasto, saldoPorMes: saldo, gastoPorCuenta: porCuenta, partidas: ps.length, ...(ant ? { anticipos: ant } : {}) } as GrupoCalc];
  })) as Record<GrupoDiferido, GrupoCalc>;
  return { ejercicio, fechaCorte, grupos, partidas: calc, nombres };
}

// ── Adjunto a los saldos de la agencia (mismo patrón que inversiones) ──
const ADJ = new WeakMap<object, ProyeccionDiferidos>();
export function adjuntarDiferidos(saldos: object, p: ProyeccionDiferidos) { ADJ.set(saldos, p); }
export function diferidosDe(saldos: object): ProyeccionDiferidos | null { return ADJ.get(saldos) ?? null; }
