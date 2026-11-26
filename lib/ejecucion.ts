/**
 * EJECUCIÓN PRESUPUESTARIA: presupuesto frente a lo real, cuenta por cuenta.
 *
 * - Presupuesto: los mismos árboles del Balance general y del Estado de resultados (mes a mes).
 * - Real: los Históricos cargados de cada mes del ejercicio (balance y estado de resultados del sistema contable).
 * - Cada cuenta se compara al nivel en que existe presupuesto. Debajo de una cuenta presupuestada sin subcuentas se
 *   agrega el detalle real (hasta 8 dígitos) sin presupuesto: no se reparte nada.
 * - El estado de resultados va acumulado en el año (como los reportes del sistema); el mes se obtiene restando.
 */
export interface NodoPres {
  codigo: string; label: string; valores: number[]; hijos?: NodoPres[]; cuentas?: string[]; sinDetalle?: boolean;
  /** cuenta contable de donde sale lo real cuando no es el mismo código (p. ej. la depreciación de edificios, 189905) */
  real?: string;
  /** agrega como detalle las subcuentas reales que no tienen fila en el presupuesto */
  completar?: boolean;
}

export interface FilaEjecucion {
  id: string;
  codigo: string;
  label: string;
  /** true cuando un real mayor al presupuesto es desfavorable (gastos, cartera en riesgo). */
  menos: boolean;
  /** 12 meses; null en el detalle real que no tiene presupuesto propio. */
  pres: number[] | null;
  /** 12 meses; null en los meses sin real cargado o cuentas sin real. */
  real: (number | null)[];
  hijos?: FilaEjecucion[];
}

type Reales = Record<string, Record<string, number>>; // periodo → código → valor
const NIVELES = [1, 2, 4, 6, 8, 10, 12];
const RIESGO = /^14(2[5-9]|[34]\d|5[0-8])/; // cartera que no devenga intereses y vencida

function hijosReales(codigo: string, codigos: string[]): string[] {
  const n = NIVELES.find((l) => l > codigo.length);
  return n ? codigos.filter((c) => c.length === n && c.startsWith(codigo)) : [];
}

/** Arma las filas a partir del árbol del presupuesto, con lo real de cada mes. */
export function armarFilas(
  raices: (NodoPres | undefined)[], reales: Reales, periodos: string[], nombres: Record<string, string>, tipo: "BAL" | "ER",
): FilaEjecucion[] {
  const codigosReales = [...new Set(periodos.flatMap((p) => Object.keys(reales[p] ?? {})))];
  const realDe = (cods: string[]) => periodos.map((p) => {
    const m = reales[p];
    if (!m) return null;
    let hay = false, t = 0;
    for (const c of cods) if (m[c] !== undefined) { hay = true; t += m[c]; }
    return hay ? t : 0;
  });
  const menosDe = (codigo: string, label: string, padreMenos: boolean) =>
    tipo === "ER" ? codigo.startsWith("4") || (!codigo && padreMenos) : padreMenos || RIESGO.test(codigo) || /riesgo/i.test(label);
  let n = 0;
  const detalle = (codigo: string, menos: boolean): FilaEjecucion[] =>
    hijosReales(codigo, codigosReales).map((c) => ({
      id: `r${n++}`, codigo: c, label: nombres[c] || c, menos, pres: null, real: realDe([c]),
      ...(hijosReales(c, codigosReales).length ? { hijos: detalle(c, menos) } : {}),
    }));
  const ir = (x: NodoPres, padreMenos: boolean, ancestro = ""): FilaEjecucion => {
    const menos = menosDe(x.codigo, x.label, padreMenos);
    // una fila con código que no pertenece a su grupo (p. ej. la depreciación por bien, 1802… bajo 1899) no toma lo real de ese código
    const ajeno = !x.real && /^\d+$/.test(x.codigo) && !!ancestro && !x.codigo.startsWith(ancestro);
    const numerico = /^\d+$/.test(x.codigo) && !ajeno;
    const real = x.sinDetalle || ajeno ? periodos.map(() => null)
      : x.real ? realDe([x.real])
      : numerico ? realDe([x.codigo])
      : x.cuentas?.length ? realDe(x.cuentas)
      : periodos.map(() => null);
    const hijos = (x.hijos ?? []).map((h) => ir(h, menos, numerico ? x.codigo : ancestro));
    // detalle real debajo de una cuenta presupuestada sin subcuentas
    if (!hijos.length && !x.sinDetalle && !ajeno) {
      if (x.real) hijos.push(...detalle(x.real, menos));
      else if (numerico) hijos.push(...detalle(x.codigo, menos));
      else for (const c of x.cuentas ?? []) hijos.push({ id: `r${n++}`, codigo: c, label: nombres[c] || c, menos, pres: null, real: realDe([c]), ...(hijosReales(c, codigosReales).length ? { hijos: detalle(c, menos) } : {}) });
    }
    if (x.completar && numerico && hijos.length) {
      const cubiertas = (x.hijos ?? []).map((h) => h.real ?? h.codigo);
      const sueltas = hijosReales(x.codigo, codigosReales).filter((c) => !cubiertas.some((k) => k.startsWith(c) || c.startsWith(k)));
      for (const c of sueltas) hijos.push({ id: `r${n++}`, codigo: c, label: nombres[c] || c, menos, pres: null, real: realDe([c]), ...(hijosReales(c, codigosReales).length ? { hijos: detalle(c, menos) } : {}) });
    }
    return { id: `p${n++}`, codigo: x.codigo, label: x.label, menos, pres: x.valores.slice(0, 12).map((v) => Number(v) || 0), real, ...(hijos.length ? { hijos } : {}) };
  };
  return raices.filter((r): r is NodoPres => !!r).map((r) => ir(r, false));
}

/** Códigos reales que aparecen como detalle, para buscar sus nombres en el catálogo. */
export function codigosDeReales(reales: Reales): string[] {
  return [...new Set(Object.values(reales).flatMap((m) => Object.keys(m)))];
}

/**
 * Enlaza las filas del presupuesto que no llevan el código contable de lo real:
 * - Activo fijo: costo y depreciación de cada bien según su subcuenta (Muebles 18050501, depreciación 18991501…).
 * - Captaciones por producto: Ahorro a la vista, Crecer, Plazo fijo y Otros depósitos (el resto de la 21).
 */
export function enlazarCuentasReales(
  raices: (NodoPres | undefined)[], codigosReales: string[],
  activoFijo: Record<string, { costo: string; dep: string }>, captaciones: { vista: string[]; crecer: string[]; dpf: string[] },
) {
  const productos = [...captaciones.vista, ...captaciones.crecer, ...captaciones.dpf];
  // el resto de la 21: las subcuentas que no son de los productos, al nivel más alto posible
  const resto = (codigo: string): string[] => hijosReales(codigo, codigosReales).flatMap((c) =>
    productos.includes(c) ? [] : productos.some((k) => k.startsWith(c)) ? resto(c) : [c]);
  const ir = (x: NodoPres, padre: string) => {
    if (padre === "18" && activoFijo[x.label] && x.codigo !== activoFijo[x.label].costo) x.real = activoFijo[x.label].costo;
    if (padre === "1899" && activoFijo[x.label]) x.real = activoFijo[x.label].dep;
    if (x.codigo === "1899") x.completar = true;
    if (padre === "21") {
      if (x.codigo === "Vista") x.cuentas = captaciones.vista;
      else if (x.codigo === "Crecer") x.cuentas = captaciones.crecer;
      else if (x.codigo === "DPF") x.cuentas = captaciones.dpf;
      else if (x.codigo === "Otros21" || /^Otros depósitos/.test(x.label)) x.cuentas = resto("21");
    }
    for (const h of x.hijos ?? []) ir(h, x.codigo);
  };
  for (const r of raices) if (r) ir(r, "");
}
