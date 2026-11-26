import type { getDb } from "./turso";
import { baseHistorica } from "./base-historica";
import { cuentaCalculada } from "./calc/cuentas-calculadas";
import { calcularMontosMensuales } from "./montos-historico";
import { tomarInstantanea } from "./instantaneas";

type Db = ReturnType<typeof getDb>;

/**
 * COMPLETAR CON EL HISTÓRICO (Ingresos y Gastos, las 10 agencias)
 *
 * Cada cuenta de detalle (8 dígitos, o la de menos dígitos cuando no tiene subcuentas) que la agencia tuvo en los
 * últimos 12 meses y que la herramienta no calcula queda en el presupuesto con su histórico (reparto estacional, 0 %):
 *   1. Una cuenta madre cargada desde el histórico o creada en 0 (origen sugerido/estructura) que tiene subcuentas
 *      se quita: sus subcuentas la reemplazan (si quedaban las dos, se sumaba dos veces).
 *   2. Cuenta que falta → se crea en la hoja de su cuenta madre (la que ya usan sus hermanas).
 *      Cuenta en 0 creada por la estructura → se llena. Escrita a mano (aunque sea 0) → no se toca.
 * No entran: las que calcula la herramienta (cuentaCalculada), la nómina (450105, 450110, 450120, 450135),
 * la 51 (la calcula Ingresos 51), el fondo de liquidez (530405, Otros activos) ni la 48 (participación e impuesto a la
 * renta: dependen de la utilidad del año).
 */
const PREFIJOS = ["42", "45", "47", "52", "53", "54", "55", "56"];
const NO_ENTRA = /^(450105|450110|450120|450135|51|530405|560405|560410|48)/; // 560405/560410: modelo de provisión
const HOJA_NUEVA: Record<string, string> = {
  "42": "42 - Comisiones causadas", "47": "47 - Otros gastos y pérdidas", "52": "52 - Comisiones ganadas",
  "53": "53 - Utilidades financieras", "54": "54 - Ingresos por servicios", "55": "55 - Otros ingresos operacionales", "56": "56 - Otros Ingresos",
};
const entra = (c: string) => !cuentaCalculada(c) && !NO_ENTRA.test(c);
const total = (v: number[]) => v.reduce((t, x) => t + x, 0);

export interface PlanHistorico {
  quitadas: { agencia: string; concepto: string; hoja: string; total: number; reemplazo: string[] }[];
  agregadas: { agencia: string; concepto: string; nombre: string; hoja: string; total: number; llenada: boolean }[];
  omitidas: { agencia: string; concepto: string; nombre: string; total: number; motivo: string }[];
  /** todo: cuentas con valores que pasan a su histórico (antes → después, del año). */
  reemplazadas: { agencia: string; concepto: string; nombre: string; hoja: string; antes: number; despues: number }[];
  /** Cargadas en el presupuesto, sin histórico en los últimos 12 meses: no se tocan. */
  sinHistorico: { agencia: string; concepto: string; hoja: string; total: number; modo: string }[];
}

interface Fila { id: number; agencia_id: number; departamento: string; concepto: string; mes: number; monto: number; modo: string; origen: string | null }

/**
 * todo = true: además, TODA cuenta que no calcula la herramienta pasa a su histórico aunque se haya escrito a mano
 * (y una madre escrita a mano con subcuentas en el histórico se reemplaza por ellas). Antes de escribir se toma una
 * copia restaurable (instantánea) de las filas que cambian o se quitan. Las prorrateadas y las cuentas sin histórico
 * no se tocan (se informan).
 */
export async function completarHistorico(db: Db, ejercicio: number, aplicar: boolean, todo = false): Promise<PlanHistorico & { filasEscritas: number; copia?: number }> {
  const agencias = (await db.execute(`SELECT id, nombre FROM agencias ORDER BY id`)).rows.map((r) => ({ id: Number(r.id), nombre: String(r.nombre) }));
  const [hojasRes, filasRes, ...bases] = await Promise.all([
    db.execute({ sql: `SELECT DISTINCT nombre FROM hojas_presupuesto WHERE ejercicio = ?`, args: [ejercicio] }),
    db.execute({ sql: `SELECT id, agencia_id, departamento, concepto, mes, monto, modo, origen FROM presupuesto_departamental
                       WHERE ejercicio = ? AND agencia_id IS NOT NULL AND (concepto LIKE '4%' OR concepto LIKE '5%')`, args: [ejercicio] }),
    ...PREFIJOS.map((p) => baseHistorica(db, ejercicio, p, agencias.map((a) => a.nombre))),
  ]);
  const filas: Fila[] = filasRes.rows.map((r) => ({
    id: Number(r.id), agencia_id: Number(r.agencia_id), departamento: String(r.departamento), concepto: String(r.concepto).replace(/\D/g, ""),
    mes: Number(r.mes), monto: Number(r.monto) || 0, modo: String(r.modo ?? "directo"), origen: (r.origen as string | null) ?? null,
  }));
  const nombresHoja = [...new Set([...hojasRes.rows.map((r) => String(r.nombre)), ...filas.map((f) => f.departamento)])];
  // hoja cuyo nombre empieza con el código (ej. "450330 - Arrendamientos" para 45033005)
  const hojaPorNombre = (codigo: string) => nombresHoja.find((n) => n.replace(/\D.*$/, "") === codigo) ?? null;
  const historico = bases.flat().filter((b) => b.detalle && Math.abs(Number(b.base_ttm) || 0) >= 1 && entra(b.codigo));

  const plan: PlanHistorico = { quitadas: [], agregadas: [], omitidas: [], reemplazadas: [], sinHistorico: [] };
  const tocadas: number[] = []; // filas que se actualizan (para la copia)
  const borrar: number[] = [];
  const lote: { sql: string; args: (string | number | null)[] }[] = [];
  const automatico = (fs: Fila[]) => fs.every((f) => f.modo === "directo" && (todo || f.origen === "sugerido" || f.origen === "estructura"));
  // hoja donde se cargan las cuentas de un prefijo (la que más usan, en esta agencia o en cualquiera)
  const hojaDe = (prefijo: string, propias: Fila[], excluidas: Set<number>): string | null => {
    const cuenta = (fs: Fila[]) => {
      const n = new Map<string, number>();
      for (const f of fs) if (!excluidas.has(f.id) && f.concepto.startsWith(prefijo) && f.concepto !== prefijo) n.set(f.departamento, (n.get(f.departamento) ?? 0) + 1);
      return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    return cuenta(propias) ?? cuenta(filas);
  };

  for (const a of agencias) {
    const propias = filas.filter((f) => f.agencia_id === a.id);
    const hist = historico.filter((h) => h.agencia === a.nombre);
    const porConcepto = new Map<string, Fila[]>();
    for (const f of propias) porConcepto.set(f.concepto, [...(porConcepto.get(f.concepto) ?? []), f]);
    const tot = (c: string) => total((porConcepto.get(c) ?? []).map((f) => f.monto));

    // 1. madres automáticas con subcuentas (cargadas o en el histórico): se quitan
    const quitadas = new Set<string>();
    const hojaMadre = new Map<string, string>(); // madre quitada → su hoja (ahí van sus subcuentas)
    for (const [c, fs] of porConcepto) {
      if (!automatico(fs)) continue;
      const hijas = [...new Set([
        ...[...porConcepto.keys()].filter((k) => k !== c && k.startsWith(c) && Math.abs(tot(k)) >= 1),
        ...hist.filter((h) => h.codigo !== c && h.codigo.startsWith(c)).map((h) => h.codigo),
      ])].sort();
      if (!hijas.length) continue;
      quitadas.add(c);
      hojaMadre.set(c, fs[0].departamento);
      for (const f of fs) borrar.push(f.id);
      plan.quitadas.push({ agencia: a.nombre, concepto: c, hoja: [...new Set(fs.map((f) => f.departamento))].join(" · "), total: Math.round(tot(c)), reemplazo: hijas });
    }
    const borradas = new Set(borrar);

    // 2. cuentas del histórico
    for (const h of hist) {
      const c = h.codigo, fs = porConcepto.get(c) ?? [];
      const montos = calcularMontosMensuales(Number(h.base_ttm), h.pesos_mensuales ?? null, 0, "estacional");
      const base = { agencia: a.nombre, concepto: c, nombre: h.nombre_cuenta, total: Math.round(total(montos)) };
      if (Math.abs(base.total) < 1) continue; // redondeado al mes queda en 0
      if (fs.length) {
        if (fs.some((f) => f.modo !== "directo")) { plan.omitidas.push({ ...base, motivo: "Prorrateada desde el monto institucional (no se toca)" }); continue; }
        const conValores = Math.abs(tot(c)) >= 1;
        if (conValores && !todo) continue; // ya tiene valores
        if (!automatico(fs)) { plan.omitidas.push({ ...base, motivo: "Escrita a mano en 0 (no se toca)" }); continue; }
        const hoja = fs[0].departamento;
        const idPorMes = new Map<number, number>();
        for (const f of fs) if (!idPorMes.has(f.mes) && f.departamento === hoja) idPorMes.set(f.mes, f.id);
        // lo que ya es igual al histórico no se reescribe
        const porMes = (m: number) => fs.filter((f) => f.mes === m).reduce((t, f) => t + f.monto, 0);
        if (conValores && Array.from({ length: 12 }, (_, i) => Math.abs(porMes(i + 1) - montos[i]) < 0.5).every(Boolean)) continue;
        for (const f of fs) if (f.departamento !== hoja || idPorMes.get(f.mes) !== f.id) borrar.push(f.id);
        for (let m = 1; m <= 12; m++) {
          if (idPorMes.has(m)) tocadas.push(idPorMes.get(m)!);
          lote.push(idPorMes.has(m)
            ? { sql: `UPDATE presupuesto_departamental SET monto = ?, origen = 'sugerido' WHERE id = ?`, args: [montos[m - 1], idPorMes.get(m)!] }
            : { sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, origen, ejercicio) VALUES (?, ?, ?, ?, ?, ?, 'directo', 'sugerido', ?)`,
                args: [hoja, c, h.nombre_cuenta, m, montos[m - 1], a.id, ejercicio] });
        }
        if (conValores) plan.reemplazadas.push({ agencia: a.nombre, concepto: c, nombre: h.nombre_cuenta, hoja, antes: Math.round(tot(c)), despues: base.total });
        else plan.agregadas.push({ ...base, hoja, llenada: true });
        continue;
      }
      // una madre o subcuenta escrita a mano ya la cubre: no se carga (se sumaría dos veces)
      const cubre = [...porConcepto.keys()].find((k) => !quitadas.has(k) && k !== c && (k.startsWith(c) || c.startsWith(k)) && Math.abs(tot(k)) >= 1);
      if (cubre) { plan.omitidas.push({ ...base, motivo: `La cubre ${cubre}, escrita a mano` }); continue; }
      const madre = [...hojaMadre.keys()].filter((k) => c.startsWith(k)).sort((x, y) => y.length - x.length)[0];
      const hoja = hojaDe(c.slice(0, 6), propias, borradas) ?? hojaPorNombre(c.slice(0, 6)) ?? (madre ? hojaMadre.get(madre)! : null)
        ?? hojaDe(c.slice(0, 4), propias, borradas) ?? HOJA_NUEVA[c.slice(0, 2)] ?? null;
      if (!hoja) { plan.omitidas.push({ ...base, motivo: "No hay una hoja para su grupo" }); continue; }
      for (let m = 1; m <= 12; m++) lote.push({
        sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, origen, ejercicio) VALUES (?, ?, ?, ?, ?, ?, 'directo', 'sugerido', ?)`,
        args: [hoja, c, h.nombre_cuenta, m, montos[m - 1], a.id, ejercicio],
      });
      plan.agregadas.push({ ...base, hoja, llenada: false });
    }

    // cargadas sin histórico (ni subcuentas en el histórico): se informan, no se tocan
    for (const [c, fs] of porConcepto) {
      if (quitadas.has(c) || !entra(c) || Math.abs(tot(c)) < 1) continue;
      if (hist.some((h) => h.codigo === c || h.codigo.startsWith(c) || c.startsWith(h.codigo))) continue;
      plan.sinHistorico.push({ agencia: a.nombre, concepto: c, hoja: [...new Set(fs.map((f) => f.departamento))].join(" · "), total: Math.round(tot(c)), modo: fs[0].modo });
    }
  }

  const ids = [...new Set(borrar)];
  const escrituras = [
    ...Array.from({ length: Math.ceil(ids.length / 200) }, (_, k) => {
      const parte = ids.slice(k * 200, (k + 1) * 200);
      return { sql: `DELETE FROM presupuesto_departamental WHERE id IN (${parte.map(() => "?").join(",")})`, args: parte };
    }),
    ...lote,
  ];
  let copia: number | undefined;
  if (aplicar && escrituras.length) {
    // copia restaurable (Administración → copias) de lo que cambia o se quita
    const respaldar = [...new Set([...ids, ...tocadas])];
    if (respaldar.length) {
      copia = await tomarInstantanea(`Presupuesto ${ejercicio}: cuentas pasadas al histórico (${respaldar.length} filas)`,
        Array.from({ length: Math.ceil(respaldar.length / 500) }, (_, k) => {
          const parte = respaldar.slice(k * 500, (k + 1) * 500);
          return { tabla: "presupuesto_departamental", where: `id IN (${parte.map(() => "?").join(",")})`, args: parte };
        }));
    }
    for (let k = 0; k < escrituras.length; k += 300) await db.batch(escrituras.slice(k, k + 300), "write");
  }
  return { ...plan, filasEscritas: ids.length + lote.length, copia };
}
