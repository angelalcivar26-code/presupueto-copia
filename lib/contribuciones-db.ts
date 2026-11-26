import type { getDb } from "./turso";
import type { InsumosContribuciones } from "./calc/contribuciones";

type Db = ReturnType<typeof getDb>;

/**
 * Datos reales del año anterior al ejercicio (históricos cargados: balance mensual y estado de resultados acumulado)
 * para calibrar las contribuciones: tasa real de COSEDE, SEPS registrado cada mes, activos del segundo semestre,
 * excedente de la cooperativa y la participación de la agencia en el activo.
 */
export async function leerContribucionesReales(db: Db, agencia: string, ejercicio: number): Promise<InsumosContribuciones> {
  const anio = ejercicio - 1;
  const vacio: InsumosContribuciones = {
    ejercicio,
    cosedeReal: { periodo: null, meses: 0, pagadoFija: 0, pagadoPar: 0, base21: 0, fijaAnual: null, parAnual: null },
    sepsReal: { periodo: null, porMes: Array(12).fill(0) },
    activosSegundoSemestre: { valor: null, meses: [] },
    excedenteAnterior: { valor: null, periodo: null },
    participacionActivo: 0,
  };
  const codigos = ["1", "21", "450420", "450421", "450415", "41", "42", "43", "44", "45", "46", "47", "51", "52", "53", "54", "55", "56"];
  let filas: { oficina: string; periodo: string; tipo: string; codigo: string; valor: number }[] = [];
  try {
    const r = await db.execute({
      sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas
            WHERE oficina IN (?, 'Consolidado') AND periodo >= ? AND periodo <= ? AND codigo IN (${codigos.map(() => "?").join(",")})`,
      args: [agencia, `${anio}-01`, `${anio}-12`, ...codigos],
    });
    filas = r.rows.map((x) => ({ oficina: String(x.oficina), periodo: String(x.periodo), tipo: String(x.tipo), codigo: String(x.codigo), valor: Number(x.valor) || 0 }));
  } catch (e) {
    console.error("[contribuciones] no se pudieron leer los históricos", e);
    return vacio;
  }
  const val = (of: string, tipo: string, periodo: string, codigo: string) =>
    filas.find((f) => f.oficina === of && f.tipo === tipo && f.periodo === periodo && f.codigo === codigo)?.valor;
  const periodos = (of: string, tipo: string) => [...new Set(filas.filter((f) => f.oficina === of && f.tipo === tipo).map((f) => f.periodo))].sort();
  const mesDe = (p: string) => Number(p.slice(5, 7));
  const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const out = { ...vacio };
  // COSEDE y SEPS reales de la agencia: estado de resultados acumulado al último mes cargado del año
  const pER = periodos(agencia, "ER"), pBAL = periodos(agencia, "BAL");
  const ultimoER = pER[pER.length - 1];
  if (ultimoER) {
    const meses = mesDe(ultimoER);
    const pagadoFija = Math.abs(val(agencia, "ER", ultimoER, "450420") ?? 0), pagadoPar = Math.abs(val(agencia, "ER", ultimoER, "450421") ?? 0);
    const base21 = prom(pBAL.filter((p) => mesDe(p) <= meses).map((p) => Math.abs(val(agencia, "BAL", p, "21") ?? 0)).filter((v) => v > 0));
    out.cosedeReal = {
      periodo: ultimoER, meses, pagadoFija, pagadoPar, base21,
      fijaAnual: base21 > 0 && pagadoFija > 0 ? (pagadoFija / meses) * 12 / base21 : null,
      parAnual: base21 > 0 && pagadoFija > 0 ? (pagadoPar / meses) * 12 / base21 : null,
    };
    // SEPS de cada mes = acumulado del mes − acumulado del mes anterior
    const acum = Array.from({ length: 12 }, (_, i) => {
      const p = pER.find((x) => mesDe(x) === i + 1);
      return p ? Math.abs(val(agencia, "ER", p, "450415") ?? 0) : null;
    });
    let anterior = 0;
    out.sepsReal = {
      periodo: ultimoER,
      porMes: acum.map((a, i) => { if (a === null || i + 1 > meses) return 0; const d = a - anterior; anterior = a; return d; }),
    };
  }
  // Activos promedio jul–dic del año anterior (los meses que estén cargados)
  const h2 = pBAL.filter((p) => mesDe(p) >= 7);
  const vH2 = h2.map((p) => val(agencia, "BAL", p, "1") ?? 0).filter((v) => v > 0);
  if (vH2.length) out.activosSegundoSemestre = { valor: prom(vH2), meses: h2 };
  // Excedente de la cooperativa (Consolidado): ingresos 51–56 − gastos 41–47, anualizado al último mes cargado
  const pC = periodos("Consolidado", "ER"), ultC = pC[pC.length - 1];
  if (ultC) {
    const s = (cs: string[]) => cs.reduce((t, c) => t + (val("Consolidado", "ER", ultC, c) ?? 0), 0);
    const exc = s(["51", "52", "53", "54", "55", "56"]) - s(["41", "42", "43", "44", "45", "46", "47"]);
    out.excedenteAnterior = { valor: (exc / mesDe(ultC)) * 12, periodo: ultC };
  }
  // Participación de la agencia en el activo de la cooperativa (último balance del año con ambos datos)
  const pComun = pBAL.filter((p) => (val("Consolidado", "BAL", p, "1") ?? 0) > 0).pop();
  if (pComun) out.participacionActivo = (val(agencia, "BAL", pComun, "1") ?? 0) / (val("Consolidado", "BAL", pComun, "1") as number);
  return out;
}
