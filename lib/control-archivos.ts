/**
 * Control de los archivos subidos en Carga de datos (Balances y Estados de resultados): se revisa todo lo cargado, no
 * solo el ejercicio. Solo lee; no cambia nada.
 *  1. Cuadre: activo − pasivo − patrimonio del balance = resultado del estado de resultados del mismo mes (5 − 4).
 *     Antes del cierre el resultado del año está en 4 y 5; si el balance ya lo trae en patrimonio, la diferencia es 0
 *     y entonces el resultado debe ser 0 o venir el mes de cierre.
 *  2. Consolidado = suma de las 10 agencias, en las cuentas de 1 y 2 dígitos. En el balance el Consolidado elimina los
 *     préstamos entre oficinas (1908 y 2908), así que se descuentan de la suma.
 *  3. Meses completos: cada oficina, desde su primer mes cargado hasta el último mes cargado de la cooperativa, tiene su
 *     balance y su estado de resultados.
 */
type Db = { execute: (q: string | { sql: string; args: (string | number)[] }) => Promise<{ rows: Record<string, unknown>[] }> };
export interface HallazgoArchivo { agencia?: string; periodo?: string; texto: string; diferencia?: number }
export interface ControlArchivo { id: string; titulo: string; descripcion: string; href: string; estado: "ok" | "error" | "aviso" | "sin-datos"; hallazgos: HallazgoArchivo[] }

const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];
const OFICINAS = [...AGENCIAS, "Consolidado"];
const TOL = 1; // dólares: diferencias menores son redondeo
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const txt = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(0, 4)}`;
const fmt = (v: number) => v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const siguiente = (p: string) => { const a = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; };

export async function controlesArchivos(db: Db): Promise<ControlArchivo[]> {
  // cuentas de 1 y 2 dígitos por su código (índice tipo+código: lee solo esas filas, no toda la tabla)
  const cods = [...Array.from({ length: 9 }, (_, i) => String(i + 1)), ...Array.from({ length: 90 }, (_, i) => String(i + 10)), "1908", "2908"];
  const [cuentas, resumen] = await Promise.all([
    db.execute({ sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas WHERE tipo IN ('BAL','ER') AND codigo IN (${cods.map(() => "?").join(",")})`, args: cods }),
    // qué hay cargado por oficina y mes: del resumen (una fila por oficina y mes), no de la tabla completa
    db.execute(`SELECT oficina, periodo, bal, er, co FROM historico_resumen`).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  const inventario = { rows: resumen.rows.flatMap((r) => [
    ...(Number(r.bal) ? [{ oficina: r.oficina, periodo: r.periodo, tipo: "BAL" }] : []),
    ...(Number(r.er) ? [{ oficina: r.oficina, periodo: r.periodo, tipo: "ER" }] : []),
    ...(Number(r.co) ? [{ oficina: r.oficina, periodo: r.periodo, tipo: "CO" }] : []),
  ]) };
  const v = new Map<string, Map<string, number>>(); // oficina|periodo|tipo → código → valor
  for (const r of cuentas.rows) {
    const k = `${r.oficina}|${r.periodo}|${r.tipo}`;
    const m = v.get(k) ?? new Map<string, number>();
    m.set(String(r.codigo), Number(r.valor) || 0);
    v.set(k, m);
  }
  const hay = new Set(inventario.rows.map((r) => `${r.oficina}|${r.periodo}|${r.tipo}`));
  const de = (o: string, p: string, t: string, c: string) => v.get(`${o}|${p}|${t}`)?.get(c) ?? 0;
  const controles: ControlArchivo[] = [];
  const href = "/carga-datos";
  if (!inventario.rows.length) {
    return [{ id: "archivos-cuadre", titulo: "Archivos cargados", descripcion: "Balances y estados de resultados subidos en Carga de datos", href, estado: "sin-datos", hallazgos: [] }];
  }
  const orden = (a: HallazgoArchivo, b: HallazgoArchivo) => OFICINAS.indexOf(a.agencia ?? "") - OFICINAS.indexOf(b.agencia ?? "") || (a.periodo ?? "").localeCompare(b.periodo ?? "");

  // 1. Cuadre del balance con el estado de resultados del mismo mes
  {
    const h: HallazgoArchivo[] = [];
    let pares = 0;
    for (const r of inventario.rows) {
      if (r.tipo !== "BAL") continue;
      const o = String(r.oficina), p = String(r.periodo);
      if (!hay.has(`${o}|${p}|ER`)) continue;
      pares++;
      const dif = de(o, p, "BAL", "1") - de(o, p, "BAL", "2") - de(o, p, "BAL", "3");
      const res = de(o, p, "ER", "5") - de(o, p, "ER", "4");
      if (Math.abs(dif - res) > TOL && Math.abs(dif) > TOL)
        h.push({ agencia: o, periodo: p, diferencia: dif - res, texto: `Activo − pasivo − patrimonio ${fmt(dif)}; resultado del estado de resultados ${fmt(res)}` });
    }
    controles.push({ id: "archivos-cuadre", titulo: "Archivos: balance y estado de resultados", descripcion: "Activo − pasivo − patrimonio del balance es igual al resultado del estado de resultados del mismo mes",
      href, estado: !pares ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h.sort(orden) });
  }

  // 2. Consolidado = suma de las agencias
  {
    const h: HallazgoArchivo[] = [];
    let comparados = 0;
    const periodosCons = inventario.rows.filter((r) => r.oficina === "Consolidado" && (r.tipo === "BAL" || r.tipo === "ER"));
    for (const r of periodosCons) {
      const p = String(r.periodo), t = String(r.tipo);
      const faltan = AGENCIAS.filter((a) => !hay.has(`${a}|${p}|${t}`));
      if (faltan.length) { h.push({ agencia: "Consolidado", periodo: p, texto: `${t === "BAL" ? "Balance" : "Estado de resultados"}: no se puede comparar, faltan ${faltan.join(", ")}` }); continue; }
      comparados++;
      const cons = v.get(`Consolidado|${p}|${t}`) ?? new Map<string, number>();
      const codigos = new Set<string>([...cons.keys()].filter((c) => c.length <= 2));
      for (const a of AGENCIAS) for (const c of v.get(`${a}|${p}|${t}`)?.keys() ?? []) if (c.length <= 2) codigos.add(c);
      const elim = (pref: string) => (t === "BAL" ? AGENCIAS.reduce((s, a) => s + de(a, p, t, pref), 0) : 0);
      const e1908 = elim("1908"), e2908 = elim("2908");
      for (const c of [...codigos].sort()) {
        let suma = AGENCIAS.reduce((s, a) => s + de(a, p, t, c), 0);
        if (t === "BAL" && (c === "1" || c === "19")) suma -= e1908;
        if (t === "BAL" && (c === "2" || c === "29")) suma -= e2908;
        const d = (cons.get(c) ?? 0) - suma;
        if (Math.abs(d) > TOL) h.push({ agencia: "Consolidado", periodo: p, diferencia: d, texto: `${t === "BAL" ? "Balance" : "Estado de resultados"}, cuenta ${c}: Consolidado ${fmt(cons.get(c) ?? 0)}; suma de agencias ${fmt(suma)}${t === "BAL" && /^(1|19|2|29)$/.test(c) ? " (sin préstamos entre oficinas)" : ""}` });
      }
    }
    const errores = h.some((x) => x.diferencia !== undefined);
    controles.push({ id: "archivos-consolidado", titulo: "Archivos: Consolidado", descripcion: "El Consolidado subido es igual a la suma de las 10 agencias (sin los préstamos entre oficinas 1908 y 2908)",
      href, estado: !periodosCons.length ? "sin-datos" : errores ? "error" : h.length ? "aviso" : comparados ? "ok" : "sin-datos", hallazgos: h.sort(orden) });
  }

  // 3. Meses completos por oficina
  {
    const h: HallazgoArchivo[] = [];
    for (const [t, nombre] of [["BAL", "Balances"], ["ER", "Estados de resultados"], ["CO", "Cuentas de orden"]] as const) {
      const periodos = inventario.rows.filter((r) => r.tipo === t).map((r) => String(r.periodo)).sort();
      if (!periodos.length) continue;
      const ultimo = periodos[periodos.length - 1];
      for (const o of OFICINAS) {
        const propios = periodos.filter((p) => hay.has(`${o}|${p}|${t}`));
        if (!propios.length) { if (t !== "CO") h.push({ agencia: o, texto: `${nombre}: no hay ninguno cargado` }); continue; }
        const faltan: string[] = [];
        for (let p = propios[0]; p <= ultimo; p = siguiente(p)) if (!hay.has(`${o}|${p}|${t}`)) faltan.push(p);
        if (faltan.length) h.push({ agencia: o, periodo: faltan[0], texto: `${nombre}: faltan ${faltan.length} ${faltan.length === 1 ? "mes" : "meses"} (${faltan.slice(0, 12).map(txt).join(", ")}${faltan.length > 12 ? ", …" : ""})` });
      }
    }
    controles.push({ id: "archivos-meses", titulo: "Archivos: meses completos", descripcion: "Cada oficina tiene balance y estado de resultados de todos los meses, desde su primer mes cargado hasta el último de la cooperativa",
      href, estado: h.length ? "aviso" : "ok", hallazgos: h.sort(orden) });
  }
  return controles;
}
