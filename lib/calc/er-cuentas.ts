/**
 * ESTADO DE RESULTADOS POR CUENTA (misma estructura que el estado de resultados real de la agencia).
 *
 * Los totales salen del motor (calcularEstadoResultadosMatriz); aquí solo se ordenan:
 *  1. Cada valor del motor se baja a su cuenta hoja: nómina en 4501 (sueldo, décimos, IESS, fondo de reserva),
 *     4101 por producto, 5104 por producto y mora, depreciaciones por tipo de bien, impuestos por subcuenta,
 *     y lo cargado a mano en el presupuesto con su propio código.
 *  2. Si un valor queda en una cuenta de grupo y el balance de la agencia tiene una sola subcuenta con saldo debajo,
 *     se asigna a esa subcuenta.
 *  3. El árbol (4 → 45 → 4501 → 450105 → 45010505) se arma por niveles del código, con los nombres del Catálogo de
 *     cuentas; además aparecen todas las cuentas 4 y 5 que trae el balance cargado (en cero si no se proyectan).
 *  4. Cada grupo es la suma de sus hijos. Si una cuenta de grupo tiene un valor propio además de subcuentas, ese valor
 *     va en una fila "Sin detalle por subcuenta". Control: la suma de las hojas debe dar los totales del motor.
 */
import {
  construirTodosLosMotores, calcularEstadoResultadosMatriz, lineasNominaPorMes, agruparPorConceptoExacto,
  type SaldosPorCodigo, type FilaParametroCaptaciones, type FilaParametroCredito, type FilaPresupuestoDepartamental,
  type FilaEmpleadoNomina, type FilaOficialCredito, type MetasCreditoInstitucional, type FactoresDepreciacion,
  type FilaParametroOtrosPasivo, type NodoBalance, type Linea, claveConceptoPorCuenta,
} from "./orquestador";
import { filasSinRecuperaciones } from "./provision-flow-integracion";
import { CUENTA_4402 } from "./provision-flow";

interface NodoCuenta { codigo: string; label: string; valores: number[]; hijos?: NodoCuenta[]; sinDetalle?: boolean }
interface Hoja { codigo: string; nombre: string; valores: number[] }

const LIMITE = 0.5;
const cero = () => Array(12).fill(0) as number[];
const sumar = (...xs: number[][]) => Array.from({ length: 12 }, (_, i) => xs.reduce((t, x) => t + (x[i] ?? 0), 0));
const restar = (a: number[], b: number[]) => a.map((v, i) => v - (b[i] ?? 0));
const acum = (x: number[]) => { let t = 0; return x.map((v) => (t += v)); };
const hayValor = (x: number[]) => x.some((v) => Math.abs(v) >= LIMITE);
const digitos = (c: string) => String(c).replace(/\D/g, "");
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const NIVELES = [1, 2, 4, 6, 8, 10, 12];
function padre(codigo: string): string | null {
  const n = codigo.length; let p: number | null = null;
  for (const l of NIVELES) if (l < n) p = l;
  return p === null ? null : codigo.slice(0, p);
}

/** Nombres de respaldo de los grupos si el catálogo no los trae. */
const NOMBRES_GRUPO: Record<string, string> = {
  "4": "EGRESOS", "5": "INGRESOS",
  "41": "Intereses causados", "4101": "Obligaciones con el público", "4103": "Obligaciones financieras",
  "42": "Comisiones causadas", "44": "Provisiones", "4402": "Cartera de créditos", "45": "Gastos de operación",
  "4501": "Gastos de personal", "4502": "Honorarios", "4503": "Servicios varios", "4504": "Impuestos, contribuciones y multas",
  "4505": "Depreciaciones", "4506": "Amortizaciones", "4507": "Otros gastos", "47": "Otros gastos y pérdidas",
  "48": "Impuestos y participación a empleados", "51": "Intereses y descuentos ganados", "5101": "Depósitos",
  "5103": "Intereses y descuentos de inversiones en títulos valores", "5104": "Intereses y descuentos de cartera de créditos",
  "5190": "Otros intereses y descuentos", "53": "Utilidades financieras", "54": "Ingresos por servicios",
  "55": "Otros ingresos operacionales", "56": "Otros ingresos",
};

/**
 * Elige la subcuenta de `grupo` cuyo nombre contiene alguna palabra clave: primero las que tienen saldo en el balance
 * de la agencia (la de mayor saldo), luego las del catálogo. null si ninguna coincide.
 */
function subcuentaPorNombre(grupo: string, claves: string[], catalogo: Record<string, string>, saldos: SaldosPorCodigo, excluir: string[] = []): string | null {
  const c = Object.keys(catalogo).filter((k) => k.startsWith(grupo) && k.length === grupo.length + 2 && !excluir.some((x) => sinTildes(catalogo[k]).includes(x)));
  const coinciden = c.filter((k) => claves.some((x) => sinTildes(catalogo[k]).includes(x)));
  if (!coinciden.length) return null;
  const conSaldo = coinciden.filter((k) => Math.abs(Number(saldos[k]) || 0) > 0).sort((a, b) => Math.abs(Number(saldos[b])) - Math.abs(Number(saldos[a])));
  return conSaldo[0] ?? coinciden.sort()[0];
}

/** Hojas del árbol del motor; si un grupo no cuadra con sus hijos, la diferencia queda como hoja del grupo. */
function hojasDe(n: NodoBalance): Hoja[] {
  if (!n.hijos?.length) return [{ codigo: n.codigo, nombre: n.label, valores: [...n.valores] }];
  const hs = n.hijos.flatMap(hojasDe);
  const resto = restar(n.valores, sumar(...n.hijos.map((h) => h.valores)));
  return hayValor(resto) ? [...hs, { codigo: n.codigo, nombre: n.label, valores: resto }] : hs;
}

export function calcularEstadoResultadosPorCuenta(
  saldos: SaldosPorCodigo,
  paramsCaptaciones: FilaParametroCaptaciones[],
  paramsCredito: FilaParametroCredito[],
  filasPresupuesto: FilaPresupuestoDepartamental[],
  empleados: FilaEmpleadoNomina[],
  agenciaNombre: string,
  oficialesCredito: FilaOficialCredito[],
  metasCredito: MetasCreditoInstitucional | undefined,
  factoresDepreciacion: FactoresDepreciacion | undefined,
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[],
  catalogo: Record<string, string>,
  /** Estado de resultados del motor ya calculado (evita calcularlo dos veces). */
  erMotor?: ReturnType<typeof calcularEstadoResultadosMatriz>,
  /** Cuentas que existen en el presupuesto del ejercicio (cualquier agencia): se muestran aunque estén en cero. */
  cuentasPresupuesto: { codigo: string; nombre: string }[] = [],
  /** Estado de resultados real del último mes cargado de la agencia (código → valor): su estructura de subcuentas. */
  erReal: Record<string, number> = {},
) {
  const args = [saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, empleados, agenciaNombre, oficialesCredito, metasCredito, factoresDepreciacion, parametrosOtrosPasivo] as const;
  const er = erMotor ?? calcularEstadoResultadosMatriz(...args);
  const m = construirTodosLosMotores(...args);
  const filasER = m.provisionFlow ? filasSinRecuperaciones(filasPresupuesto) : filasPresupuesto;
  const agrupar = (prefijo: string, filtro: (c: string) => boolean = () => true) =>
    agruparPorConceptoExacto(filasER, prefijo).filter((h) => filtro(h.codigo)).map((h) => ({ codigo: h.codigo, nombre: h.label, valores: acum(h.valores) }));
  const sub = (grupo: string, claves: string[], respaldo: string, excluir: string[] = []) => subcuentaPorNombre(grupo, claves, catalogo, saldos, excluir) ?? respaldo;

  // ---------- 1. Hojas con su cuenta ----------
  const refinar = (h: Hoja): Hoja[] => {
    const c = h.codigo === "5101/5103" ? "5101" : digitos(h.codigo);
    if (c !== digitos(h.codigo)) return [{ ...h, codigo: c }];
    // 4101 por producto: ahorros (vista + crecer) y plazo fijo
    if (c === "4101") {
      // ahorros = interés capitalizado de vista y crecer; plazo fijo = el resto de 4101 (saldo promedio × tasa ÷ 12)
      const vista = acum(m.captaciones.vista.map((r) => r.detalle.capitalizacionInteres));
      const crecer = acum(m.captaciones.crecer.map((r) => r.detalle.capitalizacionInteres));
      const ahorro = sumar(vista, crecer);
      const dpf = restar(h.valores, ahorro);
      const cAhorro = sub("4101", ["ahorro"], "410115");
      // ahorro a la vista (41011505) y Crecer (41011535) por separado: el motor calcula cada uno
      const cVista = sub(cAhorro, ["ahorro"], "", ["crecer", "solidari", "encaje", "program"]), cCrecer = sub(cAhorro, ["crecer"], "");
      return [
        ...(cVista && cCrecer ? [
          { codigo: cVista, nombre: "Depósitos de ahorro (ahorro a la vista)", valores: vista },
          { codigo: cCrecer, nombre: "Ahorro crecer", valores: crecer },
        ] : [{ codigo: cAhorro, nombre: "Depósitos de ahorro", valores: ahorro }]),
        { codigo: sub("4101", ["plazo"], "410130"), nombre: "Depósitos a plazo", valores: dpf },
      ];
    }
    // 5104 por producto y mora
    if (c === "5104") {
      const claves: Record<Linea, string[]> = { PRODUCTIVO: ["productivo", "comercial"], CONSUMO: ["consumo"], INMOBILIARIO: ["inmobiliari", "vivienda"], MICROCREDITO: ["microcredito"] };
      const respaldo: Record<Linea, string> = { PRODUCTIVO: "510405", CONSUMO: "510410", INMOBILIARIO: "510415", MICROCREDITO: "510420" };
      const rel = m.relacionMoraInteresNormal ?? 0;
      const porLinea = m.lineasNombres.map((l, i) => ({ l, v: acum(m.lineasCartera[i].ingresoPorInteres) }));
      return [
        ...porLinea.map(({ l, v }) => ({ codigo: sub("5104", claves[l], respaldo[l], ["mora"]), nombre: `Cartera ${l.toLowerCase()}`, valores: v })),
        // interés de mora = cartera × relación de mora (Metas por rango); se toma como el resto de 5104 para que cuadre exacto
        { codigo: sub("5104", ["mora"], "510450"), nombre: `De mora (${(rel * 100).toFixed(2)} % del interés de cartera)`, valores: restar(h.valores, sumar(...porLinea.map((x) => x.v))) },
      ];
    }
    // 4504 "impuestos fiscales, municipales y otros": cada subcuenta cargada
    if (c === "4504") return agrupar("4504", (k) => !/^4504(15|20|21)/.test(k));
    // provisión de cartera sin flow rates: la línea viene sin código
    if (c === "" && /productivo|consumo|inmobiliario|microcr/i.test(h.nombre)) {
      const l = (["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as Linea[]).find((x) => sinTildes(h.nombre).includes(x.toLowerCase().slice(0, 6)))!;
      return [{ codigo: CUENTA_4402[l], nombre: h.nombre, valores: h.valores }];
    }
    // grupos que el motor trae en un solo valor: se abren con lo cargado en el presupuesto
    if (["42", "47", "48", "52", "53", "54", "55", "56"].includes(c)) {
      const hs = agrupar(c, (k) => k !== c && !(c === "56" && m.provisionFlow && /^5604(05|10)/.test(k)));
      const resto = restar(h.valores, sumar(...hs.map((x) => x.valores)));
      // sin nada cargado el grupo queda igual (en cero): se muestra con "—"
      return hayValor(resto) || !hs.length ? [...hs, { ...h, codigo: c, valores: resto }] : hs;
    }
    // cuenta que sale de lo cargado en el presupuesto (ej. 450415 SEPS): se abre en las subcuentas cargadas
    if (c && claveConceptoPorCuenta(c)) {
      const hs = agrupar(c, (k) => k !== c);
      if (hs.length) return hs;
    }
    return [{ ...h, codigo: c || h.codigo }];
  };

  // 4501: la diferencia entre el total y lo cargado a mano es la nómina
  const nomina = lineasNominaPorMes(filasPresupuesto, empleados);
  const hojasNomina = (resto: Hoja): Hoja[] => {
    if (!nomina) return [resto];
    const hs: Hoja[] = [
      { codigo: sub("4501", ["remuneracion"], "450105", ["otras"]), nombre: "Remuneraciones mensuales", valores: acum(nomina.sueldoPorMes) },
      // décimo tercero y décimo cuarto en sus subcuentas de Beneficios sociales (45011005 y 45011010)
      { codigo: sub(sub("4501", ["beneficios sociales"], "450110"), ["tercer"], "45011005"), nombre: "Décimo tercer sueldo", valores: acum(nomina.decimoTerceroPorMes) },
      { codigo: sub(sub("4501", ["beneficios sociales"], "450110"), ["cuarto"], "45011010"), nombre: "Décimo cuarto sueldo", valores: acum(nomina.decimoCuartoPorMes) },
      { codigo: sub("4501", ["aportes al iess", "aporte patronal", "iess"], "450120", ["fondo"]), nombre: "Aportes al IESS", valores: acum(nomina.iessPatronalPorMes) },
      { codigo: sub("4501", ["fondo de reserva"], "450135"), nombre: "Fondo de reserva IESS", valores: acum(nomina.fondoReservaPorMes) },
    ];
    const r = restar(resto.valores, sumar(...hs.map((x) => x.valores)));
    return hayValor(r) ? [...hs, { ...resto, valores: r }] : hs;
  };

  // cada hoja refinada debe sumar lo mismo que la hoja del motor: si no, la diferencia queda en la cuenta original
  const conResto = (h: Hoja, hs: Hoja[]): Hoja[] => {
    const r = restar(h.valores, sumar(...hs.map((x) => x.valores)));
    return hayValor(r) ? [...hs, { ...h, valores: r }] : hs;
  };
  const hojasGrupo = (raiz: NodoBalance) => (raiz.hijos ?? []).flatMap(hojasDe)
    .flatMap((h) => conResto(h, digitos(h.codigo) === "4501" ? hojasNomina(h) : refinar(h)))
    .map((h) => ({ ...h, codigo: digitos(h.codigo) || digitos(raiz.codigo) }));
  const hojas = [...hojasGrupo(er.egresos as NodoBalance), ...hojasGrupo(er.ingresos as NodoBalance)];

  // ---------- 2. Cuentas del balance cargado (estructura real) ----------
  const delBalance = Object.keys(saldos).map(digitos).filter((k) => /^[45]/.test(k));
  const delPresupuesto = cuentasPresupuesto.map((c) => digitos(c.codigo)).filter((k) => /^[45]/.test(k));
  const conocidas = [...new Set([...delBalance, ...delPresupuesto])];
  const esHoja = (k: string) => !conocidas.some((x) => x !== k && x.startsWith(k));
  // Un valor calculado que cae en una cuenta de grupo (ej. COSEDE en 450420) va a su subcuenta real si hay una sola
  // (ej. 45042010), o a la única con saldo en el balance. Así no aparecen filas que no existen.
  // también con las subcuentas del estado de resultados real de la agencia (último mes cargado): un valor del motor en
  // 410130 pasa a 41013005 si es la única subcuenta que existe o la única con saldo; con dos o más, se queda en la madre
  const reales = Object.keys(erReal).map(digitos).filter((k) => /^[45]/.test(k));
  const todas = [...new Set([...conocidas, ...reales])];
  const esHojaT = (k: string) => !todas.some((x) => x !== k && x.startsWith(k));
  for (const h of hojas) {
    const debajo = todas.filter((x) => x !== h.codigo && x.startsWith(h.codigo) && esHojaT(x) && x.length <= 8);
    const conSaldo = debajo.filter((x) => Math.abs(Number(saldos[x]) || 0) > 0 || Math.abs(Number(erReal[x]) || 0) > 0);
    if (debajo.length === 1) h.codigo = debajo[0];
    else if (conSaldo.length === 1) h.codigo = conSaldo[0];
  }

  // ---------- 3. Árbol por niveles del código ----------
  const nodos = new Map<string, NodoCuenta & { propio: number[] }>();
  const nombre = (k: string, resp?: string) => catalogo[k] ?? NOMBRES_GRUPO[k] ?? resp ?? nombrePres[k] ?? `Cuenta ${k}`;
  const asegurar = (k: string, resp?: string): NodoCuenta & { propio: number[] } => {
    let n = nodos.get(k);
    if (!n) {
      n = { codigo: k, label: nombre(k, resp), valores: cero(), propio: cero() };
      nodos.set(k, n);
      const p = padre(k); if (p) asegurar(p);
    }
    return n;
  };
  for (const k of delBalance) asegurar(k);
  // cuentas que existen en el presupuesto (aunque esta agencia no tenga valor): mismo esquema en todas las agencias
  const nombrePres = Object.fromEntries(cuentasPresupuesto.map((c) => [digitos(c.codigo), c.nombre]));
  for (const c of cuentasPresupuesto) { const k = digitos(c.codigo); if (/^[45]/.test(k)) asegurar(k, c.nombre); }
  for (const h of hojas) { const n = asegurar(h.codigo, h.nombre); n.propio = sumar(n.propio, h.valores); }
  const hijosDe = (k: string) => [...nodos.values()].filter((n) => padre(n.codigo) === k).sort((a, b) => a.codigo.localeCompare(b.codigo));
  const construir = (k: string): NodoCuenta => {
    const n = nodos.get(k)!, hs = hijosDe(k).map((h) => construir(h.codigo));
    if (!hs.length) return { codigo: k, label: n.label, valores: n.propio };
    if (hayValor(n.propio)) hs.push({ codigo: k, label: "Sin detalle por subcuenta", valores: n.propio, sinDetalle: true });
    return { codigo: k, label: n.label, valores: sumar(...hs.map((h) => h.valores)), hijos: hs };
  };
  const egresos = { ...construir("4"), label: "EGRESOS" };
  const ingresos = { ...construir("5"), label: "INGRESOS" };

  // ---------- 4. Control contra el motor ----------
  const control = { egresos: restar(egresos.valores, er.egresos.valores), ingresos: restar(ingresos.valores, er.ingresos.valores) };
  return { egresos, ingresos, control, cuadra: !hayValor(control.egresos) && !hayValor(control.ingresos) };
}
