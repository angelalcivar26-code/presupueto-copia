/**
 * Controles de la provisión de cartera (Administración → Integridad). Solo leen; no cambian nada.
 *  1. Cuadre: el gasto 4402 y la reversión 5604.10 del modelo son los del Estado de resultados, y la provisión 1499 a
 *     diciembre del Balance es la de las líneas del modelo más las subcuentas que no modela (genérica, no reversadas).
 *  2. Razonable frente a lo real: el gasto neto mensual del ejercicio no se aleja más de ±30 % del real sin alivio.
 *  3. Mejoras: las mejoras guardadas (idóneo, que llega hasta 25 %, más la meta de morosidad que apruebe la administración)
 *     no bajan la provisión más de 30 % frente al comportamiento real de la agencia: el mismo límite de la política de
 *     Cartera → Provisión → Controles.
 *  4. Mismos meses: el ritmo de atraso, el tramo E, la referencia de cartera y el real comparativo empiezan en el mismo mes,
 *     y la ventana y el Estado de resultados del modelo llegan al último mes cargado.
 */
import { PRODUCTOS, proyectarProvisionFlow, type ParametrosFlow, type Producto, type Escenario } from "./calc/provision-flow";
import { CODIGOS_PROVISION_CARTERA } from "./calc/orquestador";
import { LIMITE_RAZONABLE_BASE } from "./calc/base-calibracion";

export interface HallazgoProv { agencia?: string; texto: string; diferencia?: number }
export interface ControlProv { id: string; titulo: string; descripcion: string; href: string; estado: "ok" | "error" | "aviso" | "sin-datos"; hallazgos: HallazgoProv[] }

interface Nodo { codigo: string; valores?: number[]; hijos?: Nodo[] }
interface ProductoMes { gastoNeto: number[]; gasto4402: number[]; reversion: number[] }
export interface FlowAgencia {
  escenario: Escenario; mesesPuente?: number;
  escenarios: Record<Escenario, { productos: Record<Producto, ProductoMes> }>;
  lineas: Record<Producto, { saldo1499: number[] }>;
  simulacion?: {
    inicial: Record<Producto, Record<string, number>>; castigoPorProducto: Record<Producto, number>; totales: Record<Producto, number[]>;
    parametros?: ParametrosFlow; parametrosSinMejoras?: ParametrosFlow;
  };
  cartera?: { referencia?: { desde?: string } | null };
  error?: string;
}
export interface EntradaControlProv {
  agencias: { agencia: string; clave: string; flow: FlowAgencia | null; er: { egresos?: Nodo; ingresos?: Nodo; cuentas?: { egresos?: Nodo; ingresos?: Nodo } } | null; bal: { activo?: Nodo } | null }[];
  ventanaDesde: string | null;
  ritmoDesde: Record<string, string | null>;           // clave de oficina → primer mes del ritmo de atraso
  real: { desde: string | null; hasta?: string | null; porOficina: Record<string, { valor: number }> } | null;
  ventanaHasta?: string | null;                        // último mes de la ventana
  ultimoCorte?: string | null;                         // último corte de Calificación cargado
  ventanaAuto?: boolean;                               // false: base aprobada fija (los cortes nuevos no la cambian)
  ventanaE?: string[];                                 // meses del tramo E y castigos
  erModeloHasta?: string | null;                       // último ER que usa el modelo de provisión
}

export const LIMITE_RAZONABLE = LIMITE_RAZONABLE_BASE;
export const LIMITE_MEJORAS = LIMITE_RAZONABLE;
const TOL = 1;

function buscar(n: Nodo | undefined, c: string): Nodo | null {
  if (!n) return null;
  if (n.codigo === c) return n;
  for (const h of n.hijos ?? []) { const x = buscar(h, c); if (x) return x; }
  return null;
}
const dic = (n: Nodo | null) => Number(n?.valores?.[11]) || 0;
const fmt = (v: number) => v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} %`;
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const per = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(0, 4)}`;

/** Gasto neto del año del modelo con unos parámetros (mismas entradas que el presupuesto). */
export function gastoModelo(f: FlowAgencia, parametros: ParametrosFlow): number {
  const s = f.simulacion!;
  const r = proyectarProvisionFlow({ parametros, escenario: f.escenario, inicial: s.inicial, castigoMensualPorProducto: s.castigoPorProducto,
    mesesPuente: f.mesesPuente ?? 0, totalesEjercicio: s.totales, restarCastigos: true });
  return PRODUCTOS.reduce((t, p) => t + r[p].gastoNeto.reduce((a, b) => a + b, 0), 0);
}

export function controlesProvision(e: EntradaControlProv): ControlProv[] {
  const href = "/cartera";
  const conFlow = e.agencias.filter((a) => a.flow && !a.flow.error && a.flow.escenarios);
  const out: ControlProv[] = [];

  // 1. Cuadre con el Estado de resultados y el Balance general
  {
    const h: HallazgoProv[] = [];
    for (const a of conFlow) {
      const prod = a.flow!.escenarios[a.flow!.escenario].productos;
      const g = PRODUCTOS.reduce((t, p) => t + (prod[p]?.gasto4402 ?? []).reduce((x, y) => x + y, 0), 0);
      const rv = PRODUCTOS.reduce((t, p) => t + (prod[p]?.reversion ?? []).reduce((x, y) => x + y, 0), 0);
      if (a.er) {
        // el detalle por cuenta del Estado de resultados (acumulado: diciembre es el año)
        const eg = a.er.cuentas?.egresos ?? a.er.egresos, ing = a.er.cuentas?.ingresos ?? a.er.ingresos;
        const e4402 = dic(buscar(eg, "4402")), e5604 = dic(buscar(ing, "560410"));
        if (Math.abs(e4402 - g) > TOL) h.push({ agencia: a.agencia, diferencia: e4402 - g, texto: `Gasto 4402: Estado de resultados ${fmt(e4402)}; modelo de provisión ${fmt(g)}` });
        if (Math.abs(e5604 - rv) > TOL) h.push({ agencia: a.agencia, diferencia: e5604 - rv, texto: `Reversión 5604.10: Estado de resultados ${fmt(e5604)}; modelo de provisión ${fmt(rv)}` });
      }
      if (a.bal?.activo) {
        // 1499 del Balance = − provisión de las líneas del modelo + las demás subcuentas que no modela (genérica, no reversadas del corte)
        const n1499 = buscar(a.bal.activo, "1499");
        if (n1499) {
          const lineas = PRODUCTOS.reduce((t, p) => t + (a.flow!.lineas?.[p]?.saldo1499?.[11] ?? 0), 0);
          const codLineas = new Set(PRODUCTOS.flatMap((p) => CODIGOS_PROVISION_CARTERA[p]));
          // las líneas vienen en el Balance como grupos sin código («Crédito Consumo»…); las demás subcuentas tienen código
          const otras = (n1499.hijos ?? []).filter((x) => x.codigo && !codLineas.has(x.codigo)).reduce((t, x) => t + dic(x), 0);
          const esperado = -lineas + otras, bg = dic(n1499);
          if (Math.abs(bg - esperado) > TOL) h.push({ agencia: a.agencia, diferencia: bg - esperado, texto: `Provisión 1499 a diciembre: Balance ${fmt(bg)}; modelo ${fmt(esperado)}` });
        }
      }
    }
    out.push({ id: "prov-cuadre", titulo: "Provisión: cuadre con los estados", descripcion: "El gasto 4402, la reversión 5604.10 y la provisión 1499 son las mismas en el modelo, el Estado de resultados y el Balance",
      href, estado: !conFlow.length ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
  }

  // 2. Razonable frente a lo real sin alivio
  {
    const h: HallazgoProv[] = [];
    let comparadas = 0;
    for (const a of conFlow) {
      const real = e.real?.porOficina?.[a.clave]?.valor;
      if (real === undefined || real <= 0) continue;
      comparadas++;
      const prod = a.flow!.escenarios[a.flow!.escenario].productos;
      const g = PRODUCTOS.reduce((t, p) => t + (prod[p]?.gastoNeto ?? []).reduce((x, y) => x + y, 0), 0);
      const d = g / real - 1;
      if (Math.abs(d) > LIMITE_RAZONABLE) h.push({ agencia: a.agencia, diferencia: (g - real) / 12, texto: `Gasto neto al mes: presupuesto ${fmt(g / 12)}; real sin alivio ${fmt(real / 12)} (${d > 0 ? "+" : "−"}${pct(Math.abs(d))})` });
    }
    out.push({ id: "prov-razonable", titulo: "Provisión: razonable frente a lo real", descripcion: `El gasto neto de provisión del ejercicio no se aleja más de ±${LIMITE_RAZONABLE * 100} % del real sin alivio (al mes)`,
      href, estado: !comparadas ? "sin-datos" : h.length ? "aviso" : "ok", hallazgos: h });
  }

  // 3. Mejoras que bajan demasiado la provisión
  {
    const h: HallazgoProv[] = [];
    let medidas = 0;
    for (const a of conFlow) {
      const s = a.flow!.simulacion;
      if (!s?.parametros || !s.parametrosSinMejoras) continue;
      const con = gastoModelo(a.flow!, s.parametros), sin = gastoModelo(a.flow!, s.parametrosSinMejoras);
      if (sin <= 0) continue;
      medidas++;
      const baja = 1 - con / sin;
      if (baja > LIMITE_MEJORAS) h.push({ agencia: a.agencia, diferencia: con - sin, texto: `Las mejoras guardadas bajan la provisión ${pct(baja)} (de ${fmt(sin / 12)} a ${fmt(con / 12)} al mes). Revise las metas de pase a riesgo, recuperación y ritmo de atraso` });
    }
    out.push({ id: "prov-mejoras", titulo: "Provisión: mejoras dentro de lo razonable", descripcion: `Las metas guardadas no bajan la provisión más de ${LIMITE_MEJORAS * 100} % frente al comportamiento real de la agencia`,
      href, estado: !medidas ? "sin-datos" : h.length ? "aviso" : "ok", hallazgos: h });
  }

  // 4. Mismos meses en todo
  {
    const h: HallazgoProv[] = [];
    const v = e.ventanaDesde;
    if (v) {
      if (e.ventanaE?.length && e.ventanaE[0] < v) h.push({ texto: `El tramo E y los castigos empiezan en ${per(e.ventanaE[0])}, antes de la ventana (${per(v)}): incluye meses con alivio` });
      if (e.ventanaAuto !== false && e.ventanaHasta && e.ultimoCorte && e.ventanaHasta < e.ultimoCorte) h.push({ texto: `La ventana llega a ${per(e.ventanaHasta)}, pero el último corte de Calificación cargado es ${per(e.ultimoCorte)}` });
      if (e.erModeloHasta && e.real?.hasta && e.erModeloHasta < e.real.hasta) h.push({ texto: `El modelo de provisión usa el Estado de resultados hasta ${per(e.erModeloHasta)}, pero en Históricos hay hasta ${per(e.real.hasta)}` });
      if (e.real?.desde && e.real.desde !== v) h.push({ texto: `El real comparativo empieza en ${per(e.real.desde)}; la ventana de la provisión, en ${per(v)}` });
      for (const a of conFlow) {
        const r = e.ritmoDesde[a.clave];
        if (r && r !== v) h.push({ agencia: a.agencia, texto: `El ritmo de atraso empieza en ${per(r)}; la ventana, en ${per(v)}` });
        const ref = a.flow!.cartera?.referencia?.desde;
        if (ref && ref < v) h.push({ agencia: a.agencia, texto: `La referencia de pase a riesgo y recuperación empieza en ${per(ref)}, antes de la ventana (${per(v)}): incluye meses con alivio` });
      }
    }
    out.push({ id: "prov-meses", titulo: "Provisión: mismos meses en todo", descripcion: "El ritmo de atraso, el tramo E, la referencia de cartera y el real comparativo usan los mismos meses sin alivio, hasta el último mes de la base (el último cargado, o el de la base aprobada si está fija)",
      href, estado: !v ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
  }
  return out;
}
