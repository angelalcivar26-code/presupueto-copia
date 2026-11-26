/**
 * EXCEL DE METAS DE UNA AGENCIA (para las jefaturas).
 *
 * Arma, con los mismos cálculos de las pantallas, un libro con las metas del ejercicio de una agencia:
 * resumen, colocación y cartera por producto, captaciones por producto, asesores, balance, estado de
 * resultados, flujo de efectivo y parámetros. Las cifras proyectadas son las del cálculo; los totales,
 * crecimientos, cartera bruta y morosidad van con fórmulas de Excel.
 *
 * armarLibroMetas() no consulta nada: recibe los datos y el módulo exceljs (así sirve en el navegador).
 */
import type ExcelJSNS from "exceljs";
import { baseDe, indicadores } from "./calc/indicadores-presupuesto";
import { CATEGORIAS_PRESUPUESTO as CATEGORIAS, valorDe, type Serie } from "./indicadores-categorias";

type ExcelJS = typeof ExcelJSNS;
type Hoja = ExcelJSNS.Worksheet;

export interface NodoCuenta { codigo: string; label: string; valores: number[]; hijos?: NodoCuenta[] }
interface MesCartera {
  mes: number;
  porVencer: { saldoInicial: number; prestamosAConceder: number; recuperacionPrestamos: number; precancelaciones: number; saldoFinal: number };
  enRiesgo: { saldoInicial: number; recuperacionNeta: number; castigos: number; saldoFinal: number };
  provision: number; ingresoPorInteres: number;
  tasas: Record<string, number | null | boolean>;
}
interface MesProduccion { operacionesAConceder: number | null; montoPromedio: number | null; creditosAlFin: number | null }
interface MesCaptacion {
  saldoInicial: number; saldoFinal: number; depositos: number; retiros: number; capitalizacionInteres: number;
  cancelaciones: number; renovaciones: number; interesCausado: number; tasas: Record<string, number | null>;
}
export interface DatosMetas {
  cooperativa: string;
  agencia: string;
  ejercicio: number;
  corte: { anio: number; mes: number };
  cartera: { detalle: Record<string, MesCartera[]>; produccion?: Record<string, MesProduccion[]>; relacionMora?: number };
  captaciones: { detalle: Record<string, MesCaptacion[]> };
  balance: { activo?: NodoCuenta; pasivo?: NodoCuenta; patrimonio?: NodoCuenta; corte?: Record<string, number> };
  resultados: { ingresos?: NodoCuenta; egresos?: NodoCuenta; resultadoDelEjercicio?: { valores: number[] }; cuentas?: { ingresos?: NodoCuenta; egresos?: NodoCuenta } | null };
  flujo: { cuenta11?: { resumen: { id: string; label: string; tipo: string; valores: number[] }[] } };
  saldosCorte: Record<string, number>;
  asesores: { usuario: string; rango: string }[];
  metasRango: { meta_junior?: number; meta_senior?: number; meta_master?: number; minimo_operaciones?: number; relacion_mora?: number } | null;
  institucionales: { nombre: string; unidad: string; valor: number; fuente?: string }[];
  /** Totales de la cooperativa a diciembre (para la participación de la agencia); null en el Consolidado. */
  cooperativaTotales: { activo: number; cartera: number; captaciones: number; utilidad: number } | null;
}

// ---------- estilo ----------
const VERDE = "FF005A28", DORADO = "FFC38A03", VERDE_SUAVE = "FFE3EEE7", DORADO_SUAVE = "FFF7EDD3", GRIS_SUAVE = "FFF4F6F5", BORDE = "FFD5DAD7", TEXTO = "FF26302B";
const NUM = '#,##0.00;(#,##0.00);"–"';
const ENT = '#,##0;(#,##0);"–"';
const PCT = '0.00%;(0.00%);"–"';
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MES_LARGO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LINEAS: [string, string][] = [["CONSUMO", "Consumo"], ["MICROCREDITO", "Microcrédito"], ["INMOBILIARIO", "Inmobiliario"], ["PRODUCTIVO", "Productivo"]];
const PRODUCTOS: [string, string][] = [["vista", "Ahorro a la vista"], ["crecer", "Ahorro Crecer"], ["dpf", "Depósitos a plazo fijo"]];

const relleno = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const nn = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ref = (hoja: string, celda: string) => `'${hoja}'!${celda}`;

/** Columnas de las hojas mensuales: A concepto · B corte · C..N meses · O total/diciembre · P crecimiento. */
const C_CORTE = 2, C_MES1 = 3, C_TOTAL = 15, C_CREC = 16;
const letra = (c: number) => { let s = ""; for (let x = c; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const L = (c: number, f: number) => `${letra(c)}${f}`;

function encabezado(ws: Hoja, d: DatosMetas, titulo: string, sub: string, ncols: number) {
  ws.views = [{ showGridLines: false }];
  const fila = (r: number, texto: string, alto: number, estilo: Partial<ExcelJSNS.Style>) => {
    ws.mergeCells(r, 1, r, ncols);
    const c = ws.getCell(r, 1); c.value = texto; Object.assign(c, estilo); ws.getRow(r).height = alto;
  };
  fila(1, d.cooperativa, 26, { font: { name: "Segoe UI", size: 14, bold: true, color: { argb: "FFFFFFFF" } }, fill: relleno(VERDE), alignment: { vertical: "middle", indent: 1 } });
  for (let c = 1; c <= ncols; c++) ws.getCell(2, c).fill = relleno(DORADO);
  ws.getRow(2).height = 4;
  fila(3, titulo, 22, { font: { name: "Segoe UI", size: 13, bold: true, color: { argb: VERDE } }, alignment: { vertical: "middle", indent: 1 } });
  fila(4, sub, 18, { font: { name: "Segoe UI", size: 10, color: { argb: "FF6B7570" } }, alignment: { vertical: "middle", indent: 1 } });
}

function cabeceraTabla(ws: Hoja, f: number, textos: (string | null)[], desde = 1) {
  const row = ws.getRow(f); row.height = 20;
  textos.forEach((t, i) => {
    const c = row.getCell(desde + i); c.value = t ?? "";
    c.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = relleno(VERDE);
    c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", indent: i === 0 ? 1 : 0, wrapText: true };
  });
}

function tituloBloque(ws: Hoja, f: number, texto: string, ncols: number, color = DORADO_SUAVE) {
  const row = ws.getRow(f); row.height = 20;
  for (let c = 1; c <= ncols; c++) row.getCell(c).fill = relleno(color);
  const c = row.getCell(1); c.value = texto;
  c.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: VERDE } };
  c.alignment = { vertical: "middle", indent: 1 };
}

function subtitulo(ws: Hoja, f: number, texto: string) {
  const c = ws.getCell(f, 1); c.value = texto;
  c.font = { name: "Segoe UI", size: 9, bold: true, italic: true, color: { argb: DORADO } };
  c.alignment = { indent: 1 };
}

function etiqueta(ws: Hoja, f: number, texto: string, opts: { negrita?: boolean; sangria?: number; fondo?: string } = {}) {
  const c = ws.getCell(f, 1); c.value = texto;
  c.font = { name: "Segoe UI", size: 10, bold: !!opts.negrita, color: { argb: TEXTO } };
  c.alignment = { indent: opts.sangria ?? 1, vertical: "middle" };
  if (opts.fondo) for (let k = 1; k <= C_CREC; k++) ws.getCell(f, k).fill = relleno(opts.fondo);
}

function poner(ws: Hoja, f: number, c: number, v: number | null, fmt: string, negrita = false) {
  const cel = ws.getCell(f, c);
  cel.value = v;
  cel.numFmt = fmt;
  cel.font = { name: "Tahoma", size: 10, bold: negrita, color: { argb: TEXTO } };
}
function formula(ws: Hoja, f: number, c: number, form: string, resultado: number | null, fmt: string, negrita = false) {
  const cel = ws.getCell(f, c);
  cel.value = { formula: form, result: resultado ?? undefined } as ExcelJSNS.CellFormulaValue;
  cel.numFmt = fmt;
  cel.font = { name: "Tahoma", size: 10, bold: negrita, color: { argb: TEXTO } };
}
function lineaInferior(ws: Hoja, f: number, hasta: number, color = BORDE) {
  for (let c = 1; c <= hasta; c++) ws.getCell(f, c).border = { bottom: { style: "thin", color: { argb: color } } };
}

/** Fila mensual. tipo "flujo": total = suma; "saldo": total = diciembre y crecimiento frente al corte; "tasa": sin total. */
function filaMensual(ws: Hoja, f: number, texto: string, valores: (number | null)[], fmt: string,
  tipo: "flujo" | "saldo" | "tasa", corte: number | null = null, opts: { negrita?: boolean; sangria?: number; fondo?: string } = {}) {
  etiqueta(ws, f, texto, opts);
  if (corte !== null) poner(ws, f, C_CORTE, corte, fmt, opts.negrita);
  valores.forEach((v, i) => poner(ws, f, C_MES1 + i, v, fmt, opts.negrita));
  const ult = L(C_MES1 + 11, f);
  if (tipo === "flujo") formula(ws, f, C_TOTAL, `SUM(${L(C_MES1, f)}:${ult})`, valores.reduce<number>((s, v) => s + n(v), 0), fmt, true);
  if (tipo === "saldo") {
    formula(ws, f, C_TOTAL, `${ult}`, nn(valores[11]), fmt, true);
    if (corte !== null) formula(ws, f, C_CREC, `IF(${L(C_CORTE, f)}=0,"",${L(C_TOTAL, f)}/${L(C_CORTE, f)}-1)`, corte ? n(valores[11]) / corte - 1 : null, PCT, true);
  }
  lineaInferior(ws, f, C_CREC);
  return f;
}

/** Fila acumulada de enero al mes (fórmula) a partir de una fila mensual. */
function filaAcumulada(ws: Hoja, f: number, texto: string, fuente: number, negrita = false) {
  etiqueta(ws, f, texto, { negrita, sangria: 2 });
  for (let i = 0; i < 12; i++) {
    const c = C_MES1 + i;
    formula(ws, f, c, i === 0 ? L(c, fuente) : `${L(c - 1, f)}+${L(c, fuente)}`, null, NUM, negrita);
  }
  lineaInferior(ws, f, C_CREC);
}
/** Variación del saldo de cada mes (enero frente al corte). */
function filaVariacion(ws: Hoja, f: number, texto: string, saldo: number, negrita = false) {
  etiqueta(ws, f, texto, { negrita });
  for (let i = 0; i < 12; i++) { const c = C_MES1 + i; formula(ws, f, c, `${L(c, saldo)}-${L(c - 1, saldo)}`, null, NUM, negrita); }
  formula(ws, f, C_TOTAL, `SUM(${L(C_MES1, f)}:${L(C_MES1 + 11, f)})`, null, NUM, true);
  lineaInferior(ws, f, C_CREC);
}

function anchosMensuales(ws: Hoja) {
  ws.getColumn(1).width = 44;
  ws.getColumn(C_CORTE).width = 16;
  for (let i = 0; i < 12; i++) ws.getColumn(C_MES1 + i).width = 15;
  ws.getColumn(C_TOTAL).width = 17;
  ws.getColumn(C_CREC).width = 12;
}
function imprimir(ws: Hoja, filasTitulo: string) {
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: filasTitulo };
}
function cabMensual(ws: Hoja, f: number, d: DatosMetas, final = "Total año", crec = "Crec. %") {
  cabeceraTabla(ws, f, ["Concepto", `Corte ${MES_LARGO[d.corte.mes - 1]}-${String(d.corte.anio).slice(2)}`, ...MESES, final, crec]);
}

// ---------- hojas ----------
interface Refs { [clave: string]: string }

function hojaCartera(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Colocación y cartera";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Colocación y cartera de crédito · ${d.agencia}`, `Metas y supuestos por producto, mes a mes · USD · punto de partida: corte ${MES_LARGO[d.corte.mes - 1]}-${d.corte.anio}`, C_CREC);
  anchosMensuales(ws);
  let f = 6;
  const filasTot: Record<string, number[]> = { col: [], rec: [], recR: [], pv: [], rg: [], prov: [], ing: [], meta: [] };
  const lineas = LINEAS.filter(([k]) => (d.cartera.detalle[k] ?? []).some((m) => n(m.porVencer.saldoInicial) || n(m.porVencer.saldoFinal) || n(m.porVencer.prestamosAConceder) || n(m.enRiesgo.saldoFinal)));
  for (const [k, nom] of lineas) {
    const m = d.cartera.detalle[k];
    const pr = d.cartera.produccion?.[k] ?? [];
    tituloBloque(ws, f, nom, C_CREC); f++;
    cabMensual(ws, f, d); f++;
    subtitulo(ws, f, "Metas"); f++;
    const fCol = filaMensual(ws, f++, "Colocación presupuestada", m.map((x) => n(x.porVencer.prestamosAConceder)), NUM, "flujo", null, { negrita: true });
    filaAcumulada(ws, f++, "Colocación acumulada", fCol);
    if (pr.some((x) => n(x.operacionesAConceder))) filaMensual(ws, f++, "Operaciones a conceder", pr.map((x) => nn(x.operacionesAConceder)), ENT, "flujo");
    if (pr.some((x) => n(x.montoPromedio))) filaMensual(ws, f++, "Monto promedio por crédito", pr.map((x) => nn(x.montoPromedio)), NUM, "tasa");
    const fRec = filaMensual(ws, f++, "Recuperación de cartera por vencer", m.map((x) => Math.abs(n(x.porVencer.recuperacionPrestamos)) + Math.abs(n(x.porVencer.precancelaciones))), NUM, "flujo");
    const fRecR = filaMensual(ws, f++, "Recuperación de cartera en riesgo", m.map((x) => Math.abs(n(x.enRiesgo.recuperacionNeta))), NUM, "flujo");
    const fPv = filaMensual(ws, f++, "Cartera por vencer", m.map((x) => n(x.porVencer.saldoFinal)), NUM, "saldo", n(m[0]?.porVencer.saldoInicial));
    const fRg = filaMensual(ws, f++, "Cartera en riesgo", m.map((x) => n(x.enRiesgo.saldoFinal)), NUM, "saldo", n(m[0]?.enRiesgo.saldoInicial));
    // cartera bruta y morosidad con fórmula
    const fBr = f++;
    etiqueta(ws, fBr, "Cartera bruta", { negrita: true, fondo: GRIS_SUAVE });
    const brC = n(m[0]?.porVencer.saldoInicial) + n(m[0]?.enRiesgo.saldoInicial);
    formula(ws, fBr, C_CORTE, `${L(C_CORTE, fPv)}+${L(C_CORTE, fRg)}`, brC, NUM, true);
    m.forEach((x, i) => formula(ws, fBr, C_MES1 + i, `${L(C_MES1 + i, fPv)}+${L(C_MES1 + i, fRg)}`, n(x.porVencer.saldoFinal) + n(x.enRiesgo.saldoFinal), NUM, true));
    formula(ws, fBr, C_TOTAL, L(C_MES1 + 11, fBr), n(m[11]?.porVencer.saldoFinal) + n(m[11]?.enRiesgo.saldoFinal), NUM, true);
    formula(ws, fBr, C_CREC, `IF(${L(C_CORTE, fBr)}=0,"",${L(C_TOTAL, fBr)}/${L(C_CORTE, fBr)}-1)`, null, PCT, true);
    lineaInferior(ws, fBr, C_CREC);
    const fMo = f++;
    etiqueta(ws, fMo, "Morosidad (cartera en riesgo ÷ cartera bruta)");
    for (const c of [C_CORTE, ...Array.from({ length: 12 }, (_, i) => C_MES1 + i), C_TOTAL]) formula(ws, fMo, c, `IF(${L(c, fBr)}=0,"",${L(c, fRg)}/${L(c, fBr)})`, null, PCT);
    lineaInferior(ws, fMo, C_CREC);
    const fProv = filaMensual(ws, f++, "Provisión de cartera", m.map((x) => n(x.provision)), NUM, "saldo");
    const fIng = filaMensual(ws, f++, "Ingreso por intereses", m.map((x) => n(x.ingresoPorInteres)), NUM, "flujo");
    subtitulo(ws, f, "Supuestos"); f++;
    const t = (c: string) => m.map((x) => nn(x.tasas[c] as number | null));
    const fMeta = filaMensual(ws, f++, "Meta de colocación de la agencia (asesores)", t("metaColocacionAgencia"), NUM, "tasa");
    filaMensual(ws, f++, "% de cumplimiento de la meta", t("cumplimientoColocacion"), PCT, "tasa");
    filaMensual(ws, f++, "% de distribución de la meta a este producto", t("pctDistribucion"), PCT, "tasa");
    filaMensual(ws, f++, "Tasa de interés anual", t("tasaInteresAnual"), PCT, "tasa");
    filaMensual(ws, f++, "% de recuperación del período", t("pctRecuperacionPeriodo"), PCT, "tasa");
    filaMensual(ws, f++, "Efectividad de la recuperación", t("tasaEfectividadRecuperacion"), PCT, "tasa");
    filaMensual(ws, f++, "% de precancelación", t("pctPrecancelacion"), PCT, "tasa");
    filaMensual(ws, f++, "% de recuperación de cartera vencida", t("tasaRecuperacionCarteraVencida"), PCT, "tasa");
    f++;
    filasTot.col.push(fCol); filasTot.rec.push(fRec); filasTot.recR.push(fRecR); filasTot.pv.push(fPv); filasTot.rg.push(fRg); filasTot.prov.push(fProv); filasTot.ing.push(fIng); filasTot.meta.push(fMeta);
    R[`col:${k}`] = ref(nombre, L(C_TOTAL, fCol));
    R[`br:${k}:corte`] = ref(nombre, L(C_CORTE, fBr)); R[`br:${k}`] = ref(nombre, L(C_TOTAL, fBr));
  }
  // total de la agencia
  tituloBloque(ws, f, "Total cartera de la agencia", C_CREC, VERDE_SUAVE); f++;
  cabMensual(ws, f, d); f++;
  const suma = (filas: number[], c: number) => filas.map((x) => L(c, x)).join("+") || "0";
  const cols = [C_CORTE, ...Array.from({ length: 12 }, (_, i) => C_MES1 + i), C_TOTAL];
  const filaSuma = (texto: string, filas: number[], conCorte: boolean, negrita = false, fmt = NUM) => {
    const r = f++;
    etiqueta(ws, r, texto, { negrita });
    for (const c of cols) if (c !== C_CORTE || conCorte) formula(ws, r, c, suma(filas, c), null, fmt, negrita || c === C_TOTAL);
    lineaInferior(ws, r, C_CREC);
    return r;
  };
  const tCol = filaSuma("Colocación presupuestada", filasTot.col, false, true);
  filaAcumulada(ws, f++, "Colocación acumulada", tCol);
  const tRec = filaSuma("Recuperación de cartera por vencer", filasTot.rec, false);
  filaSuma("Recuperación de cartera en riesgo", filasTot.recR, false);
  const tPv = filaSuma("Cartera por vencer", filasTot.pv, true);
  const tRg = filaSuma("Cartera en riesgo", filasTot.rg, true);
  const tBr = f++;
  etiqueta(ws, tBr, "Cartera bruta", { negrita: true, fondo: GRIS_SUAVE });
  for (const c of cols) formula(ws, tBr, c, `${L(c, tPv)}+${L(c, tRg)}`, null, NUM, true);
  formula(ws, tBr, C_CREC, `IF(${L(C_CORTE, tBr)}=0,"",${L(C_TOTAL, tBr)}/${L(C_CORTE, tBr)}-1)`, null, PCT, true);
  lineaInferior(ws, tBr, C_CREC);
  const tMo = f++;
  etiqueta(ws, tMo, "Morosidad (cartera en riesgo ÷ cartera bruta)");
  for (const c of cols) formula(ws, tMo, c, `IF(${L(c, tBr)}=0,"",${L(c, tRg)}/${L(c, tBr)})`, null, PCT);
  lineaInferior(ws, tMo, C_CREC);
  filaSuma("Provisión de cartera", filasTot.prov, false);
  const tIng = filaSuma("Ingreso por intereses", filasTot.ing, false);
  // diciembre en saldos: la columna total de saldos es diciembre
  for (const r of [tPv, tRg]) formula(ws, r, C_TOTAL, L(C_MES1 + 11, r), null, NUM, true);
  for (const r of [tPv, tRg]) formula(ws, r, C_CREC, `IF(${L(C_CORTE, r)}=0,"",${L(C_TOTAL, r)}/${L(C_CORTE, r)}-1)`, null, PCT, true);
  R.colTotal = ref(nombre, L(C_TOTAL, tCol)); R.recTotal = ref(nombre, L(C_TOTAL, tRec)); R.ingCartera = ref(nombre, L(C_TOTAL, tIng));
  R.brCorte = ref(nombre, L(C_CORTE, tBr)); R.br = ref(nombre, L(C_TOTAL, tBr));
  R["fila:col"] = String(tCol); R["fila:br"] = String(tBr); R["fila:mo"] = String(tMo);
  R.moCorte = ref(nombre, L(C_CORTE, tMo)); R.mo = ref(nombre, L(C_TOTAL, tMo));
  R.metaMes = ref(nombre, L(C_MES1, filasTot.meta[0] ?? 1));
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }];
  imprimir(ws, "1:4");
}

function hojaCaptaciones(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Captaciones";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Captaciones · ${d.agencia}`, `Metas y supuestos por producto, mes a mes · USD · punto de partida: corte ${MES_LARGO[d.corte.mes - 1]}-${d.corte.anio}`, C_CREC);
  anchosMensuales(ws);
  let f = 6;
  const saldos: number[] = [], deps: number[] = [], ints: number[] = [];
  for (const [k, nom] of PRODUCTOS) {
    const m = d.captaciones.detalle[k] ?? [];
    if (!m.length) continue;
    tituloBloque(ws, f, nom, C_CREC); f++;
    cabMensual(ws, f, d); f++;
    subtitulo(ws, f, "Metas"); f++;
    const fS = filaMensual(ws, f++, "Saldo", m.map((x) => n(x.saldoFinal)), NUM, "saldo", n(m[0]?.saldoInicial), { negrita: true, fondo: GRIS_SUAVE });
    const fN = f++;
    filaVariacion(ws, fN, "Captación neta (variación del saldo)", fS, true);
    filaAcumulada(ws, f++, "Captación neta acumulada", fN);
    const fD = filaMensual(ws, f++, "Depósitos", m.map((x) => n(x.depositos)), NUM, "flujo");
    filaMensual(ws, f++, "Retiros", m.map((x) => Math.abs(n(x.retiros))), NUM, "flujo");
    if (k === "dpf") {
      filaMensual(ws, f++, "Cancelaciones", m.map((x) => Math.abs(n(x.cancelaciones))), NUM, "flujo");
      filaMensual(ws, f++, "Renovaciones", m.map((x) => n(x.renovaciones)), NUM, "flujo");
    }
    filaMensual(ws, f++, "Interés capitalizado", m.map((x) => n(x.capitalizacionInteres)), NUM, "flujo");
    const fI = filaMensual(ws, f++, "Interés causado (gasto)", m.map((x) => n(x.interesCausado)), NUM, "flujo");
    // crecimiento mensual del saldo
    const fC = f++;
    etiqueta(ws, fC, "Crecimiento mensual del saldo");
    for (let i = 0; i < 12; i++) formula(ws, fC, C_MES1 + i, `IF(${L(C_MES1 + i - 1, fS)}=0,"",${L(C_MES1 + i, fS)}/${L(C_MES1 + i - 1, fS)}-1)`, null, PCT);
    lineaInferior(ws, fC, C_CREC);
    subtitulo(ws, f, "Supuestos"); f++;
    const t = (c: string) => m.map((x) => nn(x.tasas[c]));
    filaMensual(ws, f++, "Tasa de interés anual", t("tasaInteresAnual"), PCT, "tasa");
    if (k === "dpf") {
      filaMensual(ws, f++, "% de cancelaciones", t("pctCancelaciones"), PCT, "tasa");
      filaMensual(ws, f++, "Relación de renovaciones", t("ratioRenovaciones"), '0.00', "tasa");
    } else {
      filaMensual(ws, f++, "% de depósitos sobre el saldo", t("pctIngresosPeriodo"), PCT, "tasa");
      filaMensual(ws, f++, "% de retiros sobre el saldo", t("pctRetirosPeriodo"), PCT, "tasa");
    }
    f++;
    saldos.push(fS); deps.push(fD); ints.push(fI);
    R[`cap:${k}:corte`] = ref(nombre, L(C_CORTE, fS)); R[`cap:${k}`] = ref(nombre, L(C_TOTAL, fS));
    R[`neta:${k}`] = ref(nombre, L(C_TOTAL, fN));
  }
  tituloBloque(ws, f, "Total captaciones de la agencia", C_CREC, VERDE_SUAVE); f++;
  cabMensual(ws, f, d); f++;
  const cols = [C_CORTE, ...Array.from({ length: 12 }, (_, i) => C_MES1 + i), C_TOTAL];
  const tS = f++;
  etiqueta(ws, tS, "Saldo total", { negrita: true, fondo: GRIS_SUAVE });
  for (const c of cols) formula(ws, tS, c, saldos.map((x) => L(c, x)).join("+") || "0", null, NUM, true);
  formula(ws, tS, C_CREC, `IF(${L(C_CORTE, tS)}=0,"",${L(C_TOTAL, tS)}/${L(C_CORTE, tS)}-1)`, null, PCT, true);
  lineaInferior(ws, tS, C_CREC);
  const tN = f++;
  filaVariacion(ws, tN, "Captación neta (variación del saldo)", tS, true);
  filaAcumulada(ws, f++, "Captación neta acumulada", tN);
  R.netaTotal = ref(nombre, L(C_TOTAL, tN)); R["fila:capS"] = String(tS); R["fila:capN"] = String(tN);
  for (const [texto, filas] of [["Depósitos", deps], ["Interés causado (gasto)", ints]] as [string, number[]][]) {
    const r = f++;
    etiqueta(ws, r, texto);
    for (const c of cols.slice(1)) formula(ws, r, c, filas.map((x) => L(c, x)).join("+") || "0", null, NUM, c === C_TOTAL);
    lineaInferior(ws, r, C_CREC);
  }
  R.capCorte = ref(nombre, L(C_CORTE, tS)); R.cap = ref(nombre, L(C_TOTAL, tS));
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }];
  imprimir(ws, "1:4");
}

function hojaAsesores(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Asesores";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: DORADO } } });
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Metas de los asesores de crédito · ${d.agencia}`, "Meta mensual de colocación según el rango de cada asesor · USD", 5);
  [36, 16, 18, 18, 4].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const metaDe = (r: string) => n(r === "MASTER" ? d.metasRango?.meta_master : r === "SENIOR" ? d.metasRango?.meta_senior : d.metasRango?.meta_junior);
  let f = 6;
  tituloBloque(ws, f, "Metas por rango", 4); f++;
  cabeceraTabla(ws, f, ["Rango", "Meta mensual", "Meta anual"]); f++;
  for (const [r, nom] of [["JUNIOR", "Junior"], ["SENIOR", "Senior"], ["MASTER", "Master"]]) {
    etiqueta(ws, f, nom); poner(ws, f, 2, metaDe(r), NUM); formula(ws, f, 3, `B${f}*12`, metaDe(r) * 12, NUM, true); lineaInferior(ws, f, 3); f++;
  }
  f++;
  tituloBloque(ws, f, "Asesores de la agencia", 4); f++;
  cabeceraTabla(ws, f, ["Asesor", "Rango", "Meta mensual", "Meta anual"]); f++;
  const ini = f;
  for (const a of d.asesores) {
    etiqueta(ws, f, a.usuario);
    const c = ws.getCell(f, 2); c.value = a.rango.charAt(0) + a.rango.slice(1).toLowerCase(); c.font = { name: "Segoe UI", size: 10, color: { argb: TEXTO } }; c.alignment = { horizontal: "center" };
    poner(ws, f, 3, metaDe(a.rango), NUM); formula(ws, f, 4, `C${f}*12`, metaDe(a.rango) * 12, NUM);
    lineaInferior(ws, f, 4); f++;
  }
  etiqueta(ws, f, `Total (${d.asesores.length} asesor${d.asesores.length === 1 ? "" : "es"})`, { negrita: true });
  for (let c = 1; c <= 4; c++) ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
  formula(ws, f, 3, d.asesores.length ? `SUM(C${ini}:C${f - 1})` : "0", null, NUM, true);
  formula(ws, f, 4, d.asesores.length ? `SUM(D${ini}:D${f - 1})` : "0", null, NUM, true);
  R.asesores = String(d.asesores.length);
  R.metaAsesoresMes = ref(nombre, `C${f}`);
  ws.pageSetup = { orientation: "portrait", paperSize: 9, scale: 100, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } };
}

/** Árbol de cuentas hasta 4 dígitos, en el orden del plan de cuentas; sin las cuentas que quedan en cero todo el año. */
function aplanar(n0: NodoCuenta | undefined, max = 4, corte: Record<string, number> = {}): { nodo: NodoCuenta; nivel: number }[] {
  const out: { nodo: NodoCuenta; nivel: number }[] = [];
  const ir = (x: NodoCuenta, nivel: number) => {
    if (x.codigo && x.codigo.length > max) return;
    if (nivel > 0 && !Math.abs(corte[x.codigo] ?? 0) && !(x.valores ?? []).some((v) => Math.abs(n(v)) >= 0.005)) return;
    out.push({ nodo: x, nivel });
    for (const h of x.hijos ?? []) ir(h, nivel + 1);
  };
  if (n0) ir(n0, 0);
  return out;
}

function hojaBalance(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Balance general";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  const NC = 17; // A código · B cuenta · C corte · D..O meses · P var USD · Q var %
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Balance general proyectado · ${d.agencia}`, `Saldos a fin de cada mes · USD · variación de diciembre frente al corte ${MES_LARGO[d.corte.mes - 1]}-${d.corte.anio}`, NC);
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 42; ws.getColumn(3).width = 17;
  for (let i = 0; i < 12; i++) ws.getColumn(4 + i).width = 17;
  ws.getColumn(16).width = 17; ws.getColumn(17).width = 10;
  let f = 6;
  cabeceraTabla(ws, f, ["Código", "Cuenta", `Corte ${MES_LARGO[d.corte.mes - 1]}-${String(d.corte.anio).slice(2)}`, ...MESES, "Variación", "Var. %"]); f++;
  for (const raiz of [d.balance.activo, d.balance.pasivo, d.balance.patrimonio]) {
    for (const { nodo, nivel } of aplanar(raiz, 4, d.saldosCorte)) {
      const cod = ws.getCell(f, 1); cod.value = nodo.codigo; cod.font = { name: "Tahoma", size: 10, bold: nivel < 2, color: { argb: TEXTO } };
      const nom = ws.getCell(f, 2); nom.value = nodo.label; nom.font = { name: "Segoe UI", size: 10, bold: nivel < 2, color: { argb: nivel === 0 ? VERDE : TEXTO } }; nom.alignment = { indent: nivel };
      const corte = d.saldosCorte[nodo.codigo] ?? null;
      poner(ws, f, 3, corte, NUM, nivel < 2);
      nodo.valores.slice(0, 12).forEach((v, i) => poner(ws, f, 4 + i, n(v), NUM, nivel < 2));
      formula(ws, f, 16, `O${f}-C${f}`, null, NUM, nivel < 2);
      formula(ws, f, 17, `IF(C${f}=0,"",O${f}/C${f}-1)`, null, PCT, nivel < 2);
      if (nivel === 0) for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(VERDE_SUAVE);
      else if (nivel === 1) for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
      lineaInferior(ws, f, NC);
      if (nodo.codigo === "1") { R.actCorte = ref(nombre, `C${f}`); R.act = ref(nombre, `O${f}`); }
      if (nodo.codigo === "2") { R.pasCorte = ref(nombre, `C${f}`); R.pas = ref(nombre, `O${f}`); }
      if (nodo.codigo === "3") { R.patCorte = ref(nombre, `C${f}`); R.pat = ref(nombre, `O${f}`); }
      f++;
    }
    f++;
  }
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

/** Indicadores presupuestados de la agencia (mismas fórmulas que la pantalla Indicadores), agrupados por tipo. */
function serieIndicadores(d: DatosMetas): Serie | null {
  const er = { ingresos: d.resultados.cuentas?.ingresos ?? d.resultados.ingresos, egresos: d.resultados.cuentas?.egresos ?? d.resultados.egresos };
  if (!d.balance.activo || !er.ingresos) return null;
  const base = baseDe(d.balance as never, er as never);
  if (d.agencia === "Consolidado") base.consolidado = true; // las transferencias internas se compensan entre oficinas
  return { base, ind: Array.from({ length: 12 }, (_, m) => indicadores(base, m)) };
}

function hojaIndicadores(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs, serie: Serie) {
  const nombre = "Indicadores";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  const NC = 13; // A indicador · B..M meses
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Indicadores financieros · ${d.agencia}`, "Valores presupuestados de cada mes · resultados acumulados del año, anualizados donde corresponde", NC);
  ws.getColumn(1).width = 44;
  for (let i = 0; i < 12; i++) ws.getColumn(2 + i).width = 14;
  let f = 6;
  cabeceraTabla(ws, f, ["Indicador", ...MESES]); f++;
  for (const cat of CATEGORIAS) {
    tituloBloque(ws, f, cat.label, NC); f++;
    for (const ind of cat.indicadores.filter((x) => !x.soloComparar)) {
      const c = ws.getCell(f, 1); c.value = ind.label;
      c.font = { name: "Segoe UI", size: 10, color: { argb: TEXTO } }; c.alignment = { indent: 2, vertical: "middle" };
      for (let m = 0; m < 12; m++) {
        const v = valorDe(ind, serie, m);
        poner(ws, f, 2 + m, v, ind.formato === "pct" ? PCT : ENT);
        if (v !== null && v < 0) ws.getCell(f, 2 + m).font = { name: "Tahoma", size: 10, color: { argb: "FFB42318" } };
      }
      lineaInferior(ws, f, NC);
      R[`ind:${ind.id}`] = String(f);
      f++;
    }
    f++;
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

/** Indicadores que se siguen cada mes en la hoja Seguimiento (menorEsMejor: un valor menor es favorable). */
const IND_SEGUIMIENTO: { id: string; texto: string; menorEsMejor?: boolean }[] = [
  { id: "roa", texto: "ROA" }, { id: "roe", texto: "ROE" },
  { id: "morosidad", texto: "Morosidad", menorEsMejor: true }, { id: "cobertura", texto: "Cobertura" },
  { id: "prod", texto: "Activos productivos" }, { id: "improd", texto: "Activos improductivos", menorEsMejor: true },
  { id: "absorcion", texto: "Grado de absorción", menorEsMejor: true }, { id: "goActivo", texto: "Gastos operativos ÷ activo", menorEsMejor: true },
  { id: "fondosActivo", texto: "Fondos disponibles ÷ activo" }, { id: "fondeo", texto: "Captaciones ÷ cartera" },
  { id: "solvencia", texto: "Solvencia" },
];

function hojaResultados(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Estado de resultados";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  const NC = 15; // A código · B cuenta · C..N meses · O total año
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Estado de resultados proyectado · ${d.agencia}`, "Movimiento de cada mes · USD · el total del año es la suma de los 12 meses", NC);
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 42;
  for (let i = 0; i < 12; i++) ws.getColumn(3 + i).width = 16;
  ws.getColumn(15).width = 17;
  let f = 6;
  cabeceraTabla(ws, f, ["Código", "Cuenta", ...MESES, "Total año"]); f++;
  const mensual = (v: number[]) => v.slice(0, 12).map((x, i) => n(x) - (i ? n(v[i - 1]) : 0)); // la API entrega acumulados
  const arbol = { ingresos: d.resultados.cuentas?.ingresos ?? d.resultados.ingresos, egresos: d.resultados.cuentas?.egresos ?? d.resultados.egresos };
  const filaRaiz: Record<string, number> = {};
  for (const [clave, raiz] of [["ingresos", arbol.ingresos], ["egresos", arbol.egresos]] as const) {
    for (const { nodo, nivel } of aplanar(raiz)) {
      const cod = ws.getCell(f, 1); cod.value = nodo.codigo; cod.font = { name: "Tahoma", size: 10, bold: nivel < 2, color: { argb: TEXTO } };
      const nom = ws.getCell(f, 2); nom.value = nodo.label; nom.font = { name: "Segoe UI", size: 10, bold: nivel < 2, color: { argb: nivel === 0 ? VERDE : TEXTO } }; nom.alignment = { indent: nivel };
      mensual(nodo.valores).forEach((v, i) => poner(ws, f, 3 + i, v, NUM, nivel < 2));
      formula(ws, f, 15, `SUM(C${f}:N${f})`, n(nodo.valores[11]), NUM, true);
      if (nivel === 0) { filaRaiz[clave] = f; for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(VERDE_SUAVE); }
      else if (nivel === 1) for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
      lineaInferior(ws, f, NC);
      f++;
    }
    f++;
  }
  const res = d.resultados.resultadoDelEjercicio?.valores ?? [];
  const nom = ws.getCell(f, 2); nom.value = "Resultado del ejercicio"; nom.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(VERDE);
  mensual(res).forEach((v, i) => { poner(ws, f, 3 + i, v, NUM, true); ws.getCell(f, 3 + i).font = { name: "Tahoma", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; });
  formula(ws, f, 15, `SUM(C${f}:N${f})`, n(res[11]), NUM, true);
  ws.getCell(f, 15).font = { name: "Tahoma", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  if (filaRaiz.ingresos) { R.ingresos = ref(nombre, `O${filaRaiz.ingresos}`); R["fila:ing"] = String(filaRaiz.ingresos); }
  if (filaRaiz.egresos) R["fila:gas"] = String(filaRaiz.egresos);
  R["fila:res"] = String(f);
  if (filaRaiz.egresos) R.gastos = ref(nombre, `O${filaRaiz.egresos}`);
  R.utilidad = ref(nombre, `O${f}`);
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

function hojaFlujo(wb: ExcelJSNS.Workbook, d: DatosMetas) {
  const nombre = "Flujo de efectivo";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  const NC = 14; // A concepto · B..M meses · N total
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Flujo de efectivo proyectado · ${d.agencia}`, "Entradas y salidas de efectivo de cada mes · USD", NC);
  ws.getColumn(1).width = 52;
  for (let i = 0; i < 12; i++) ws.getColumn(2 + i).width = 16;
  ws.getColumn(14).width = 17;
  let f = 6;
  cabeceraTabla(ws, f, ["Concepto", ...MESES, "Total año"]); f++;
  for (const r of d.flujo.cuenta11?.resumen ?? []) {
    if (r.tipo === "grupo") { f++; tituloBloque(ws, f, r.label, NC); f++; continue; }
    const negrita = r.tipo !== "linea";
    etiqueta(ws, f, r.label, { negrita, sangria: r.tipo === "linea" ? 2 : 1, fondo: r.tipo === "saldo" ? GRIS_SUAVE : undefined });
    r.valores.slice(0, 12).forEach((v, i) => poner(ws, f, 2 + i, n(v), NUM, negrita));
    if (r.tipo === "linea" || r.tipo === "variacion") formula(ws, f, 14, `SUM(B${f}:M${f})`, r.valores.reduce((s, v) => s + n(v), 0), NUM, true);
    else if (r.id === "r-sf" || r.id === "r-se") formula(ws, f, 14, `M${f}`, n(r.valores[11]), NUM, true);
    else if (r.id === "r-si") formula(ws, f, 14, `B${f}`, n(r.valores[0]), NUM, true);
    for (let c = 1; c <= NC; c++) if (r.tipo === "saldo") ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
    lineaInferior(ws, f, NC);
    f++;
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

function hojaParametros(wb: ExcelJSNS.Workbook, d: DatosMetas) {
  const ws = wb.addWorksheet("Parámetros", { properties: { tabColor: { argb: DORADO } } });
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Parámetros institucionales`, "Valores vigentes del ejercicio que usa el cálculo", 4);
  [44, 16, 34, 4].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  let f = 6;
  cabeceraTabla(ws, f, ["Parámetro", "Valor", "Fuente"]); f++;
  const filas: { nombre: string; valor: number; fmt: string; fuente: string }[] = [
    ...d.institucionales.map((p) => ({ nombre: p.nombre, valor: p.valor, fmt: p.unidad === "pct" ? PCT : NUM, fuente: p.fuente ?? "" })),
    ...(d.metasRango ? [
      { nombre: "Relación de mora máxima por asesor", valor: n(d.metasRango.relacion_mora), fmt: PCT, fuente: "Metas de crédito institucionales" },
      { nombre: "Mínimo de operaciones por asesor", valor: n(d.metasRango.minimo_operaciones), fmt: ENT, fuente: "Metas de crédito institucionales" },
    ] : []),
  ];
  for (const p of filas) {
    etiqueta(ws, f, p.nombre); poner(ws, f, 2, p.valor, p.fmt);
    const c = ws.getCell(f, 3); c.value = p.fuente; c.font = { name: "Segoe UI", size: 10, color: { argb: "FF6B7570" } };
    lineaInferior(ws, f, 3); f++;
  }
  ws.pageSetup = { orientation: "portrait", paperSize: 9, scale: 100, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } };
}

function hojaResumen(ws: Hoja, d: DatosMetas, R: Refs) {
  const NC = 6;
  const corte = `${MES_LARGO[d.corte.mes - 1]}-${d.corte.anio}`;
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Metas de la agencia ${d.agencia}`, `Metas del ejercicio frente al punto de partida (corte ${corte}) · USD`, NC);
  [46, 18, 18, 18, 18, 3].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  let f = 6;
  tituloBloque(ws, f, "Metas de saldos a diciembre", 5); f++;
  cabeceraTabla(ws, f, ["Indicador", `Corte ${corte}`, `Meta dic-${d.ejercicio}`, "Crecimiento", "Crec. %"]); f++;
  const filaSaldo = (texto: string, c0?: string, c1?: string, opts: { negrita?: boolean; sangria?: number; pct?: boolean } = {}) => {
    if (!c0 || !c1) return;
    etiqueta(ws, f, texto, { negrita: opts.negrita, sangria: opts.sangria });
    const fmt = opts.pct ? PCT : NUM;
    formula(ws, f, 2, c0, null, fmt, opts.negrita); formula(ws, f, 3, c1, null, fmt, true);
    formula(ws, f, 4, `C${f}-B${f}`, null, fmt, opts.negrita);
    if (!opts.pct) formula(ws, f, 5, `IF(B${f}=0,"",C${f}/B${f}-1)`, null, PCT, true);
    if (opts.negrita) for (let c = 1; c <= 5; c++) ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
    lineaInferior(ws, f, 5); f++;
  };
  filaSaldo("Activo total", R.actCorte, R.act, { negrita: true });
  filaSaldo("Cartera bruta", R.brCorte, R.br, { negrita: true });
  for (const [k, nom] of LINEAS) filaSaldo(nom, R[`br:${k}:corte`], R[`br:${k}`], { sangria: 3 });
  filaSaldo("Morosidad de la cartera", R.moCorte, R.mo, { pct: true });
  filaSaldo("Captaciones", R.capCorte, R.cap, { negrita: true });
  for (const [k, nom] of PRODUCTOS) filaSaldo(nom, R[`cap:${k}:corte`], R[`cap:${k}`], { sangria: 3 });
  filaSaldo("Pasivo total", R.pasCorte, R.pas, { negrita: true });
  filaSaldo("Patrimonio", R.patCorte, R.pat, { negrita: true });
  f++;
  tituloBloque(ws, f, `Metas de gestión del año ${d.ejercicio}`, 5); f++;
  cabeceraTabla(ws, f, ["Indicador", "Meta del año"]); f++;
  const filaAnio = (texto: string, c?: string, opts: { negrita?: boolean; sangria?: number; fmt?: string } = {}) => {
    if (!c) return;
    etiqueta(ws, f, texto, { negrita: opts.negrita, sangria: opts.sangria });
    formula(ws, f, 2, c, null, opts.fmt ?? NUM, true);
    if (opts.negrita) for (let k = 1; k <= 2; k++) ws.getCell(f, k).fill = relleno(GRIS_SUAVE);
    lineaInferior(ws, f, 2); f++;
  };
  filaAnio("Colocación de crédito", R.colTotal, { negrita: true });
  for (const [k, nom] of LINEAS) filaAnio(nom, R[`col:${k}`], { sangria: 3 });
  filaAnio("Recuperación de cartera por vencer", R.recTotal);
  filaAnio("Captación neta", R.netaTotal, { negrita: true });
  for (const [k, nom] of PRODUCTOS) filaAnio(nom, R[`neta:${k}`], { sangria: 3 });
  filaAnio("Gastos de operación (techo)", R.gastos45);
  filaAnio("Ingresos totales", R.ingresos, { negrita: true });
  filaAnio("Ingreso por intereses de cartera", R.ingCartera, { sangria: 3 });
  filaAnio("Gastos totales", R.gastos, { negrita: true });
  filaAnio("Resultado del ejercicio", R.utilidad, { negrita: true });
  f++;
  tituloBloque(ws, f, "Fuerza de ventas", 5); f++;
  cabeceraTabla(ws, f, ["Indicador", "Meta"]); f++;
  etiqueta(ws, f, "Asesores de crédito activos"); poner(ws, f, 2, Number(R.asesores ?? 0), ENT, true); lineaInferior(ws, f, 2); f++;
  filaAnio("Meta mensual de colocación de los asesores", R.metaAsesoresMes);
  if (d.cooperativaTotales) {
    const t = d.cooperativaTotales;
    f++;
    tituloBloque(ws, f, `Participación de la agencia en la cooperativa · dic-${d.ejercicio}`, 5); f++;
    cabeceraTabla(ws, f, ["Indicador", "Agencia", "Cooperativa", "Participación"]); f++;
    for (const [texto, agencia, coop] of [["Activo total", R.act, t.activo], ["Cartera bruta", R.br, t.cartera], ["Captaciones", R.cap, t.captaciones], ["Resultado del ejercicio", R.utilidad, t.utilidad]] as [string, string | undefined, number][]) {
      if (!agencia) continue;
      etiqueta(ws, f, texto);
      formula(ws, f, 2, agencia, null, NUM); poner(ws, f, 3, coop, NUM);
      formula(ws, f, 4, `IF(C${f}=0,"",B${f}/C${f})`, null, PCT, true);
      lineaInferior(ws, f, 4); f++;
    }
  }
  // firmas
  f += 3;
  for (const [col, texto] of [[1, "Elaborado por"], [3, "Revisado por"], [5, "Aprobado por"]] as [number, string][]) {
    const fin = col;
    if (fin > col) ws.mergeCells(f, col, f, fin);
    const c = ws.getCell(f, col); c.value = texto;
    c.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: TEXTO } }; c.alignment = { horizontal: "center" };
    for (let k = col; k <= fin; k++) ws.getCell(f, k).border = { top: { style: "thin", color: { argb: TEXTO } } };
    if (fin > col) ws.mergeCells(f + 1, col, f + 1, fin);
    const g = ws.getCell(f + 1, col); g.value = "Nombre y cargo"; g.font = { name: "Segoe UI", size: 9, color: { argb: "FF6B7570" } }; g.alignment = { horizontal: "center" };
  }
  ws.pageSetup = { orientation: "portrait", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } };
}

function hojaGastos(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const nombre = "Gastos de la agencia";
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } } });
  const NC = 15;
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Gastos de operación · ${d.agencia}`, "Techo de gasto de cada cuenta, mes a mes · USD", NC);
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 46;
  for (let i = 0; i < 12; i++) ws.getColumn(3 + i).width = 15;
  ws.getColumn(15).width = 17;
  let f = 6;
  cabeceraTabla(ws, f, ["Código", "Cuenta", ...MESES, "Total año"]); f++;
  const raiz = d.resultados.cuentas?.egresos ?? d.resultados.egresos;
  const g45 = (raiz?.hijos ?? []).find((h) => h.codigo === "45");
  const mensual = (v: number[]) => v.slice(0, 12).map((x, i) => n(x) - (i ? n(v[i - 1]) : 0));
  for (const { nodo, nivel } of aplanar(g45, 6)) {
    const cod = ws.getCell(f, 1); cod.value = nodo.codigo; cod.font = { name: "Tahoma", size: 10, bold: nivel < 2, color: { argb: TEXTO } };
    const nom = ws.getCell(f, 2); nom.value = nodo.label; nom.font = { name: "Segoe UI", size: 10, bold: nivel < 2, color: { argb: nivel === 0 ? VERDE : TEXTO } }; nom.alignment = { indent: nivel };
    mensual(nodo.valores).forEach((v, i) => poner(ws, f, 3 + i, v, NUM, nivel < 2));
    formula(ws, f, 15, `SUM(C${f}:N${f})`, n(nodo.valores[11]), NUM, true);
    if (nivel === 0) { R.gastos45 = ref(nombre, `O${f}`); for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(VERDE_SUAVE); }
    else if (nivel === 1) for (let c = 1; c <= NC; c++) ws.getCell(f, c).fill = relleno(GRIS_SUAVE);
    lineaInferior(ws, f, NC);
    f++;
  }
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

/** Seguimiento: meta de cada mes (fórmula a las hojas), real en blanco para llenar y % de cumplimiento. */
function hojaSeguimiento(wb: ExcelJSNS.Workbook, d: DatosMetas, R: Refs) {
  const ws = wb.addWorksheet("Seguimiento", { properties: { tabColor: { argb: DORADO } } });
  const NC = 15; // A indicador · B concepto · C..N meses · O año
  encabezado(ws, d, `Presupuesto ${d.ejercicio} · Seguimiento de metas · ${d.agencia}`, "Meta, real y % de cumplimiento de cada mes · USD", NC);
  ws.getColumn(1).width = 34; ws.getColumn(2).width = 16;
  for (let i = 0; i < 12; i++) ws.getColumn(3 + i).width = 14;
  ws.getColumn(15).width = 16;
  const ENTRADA = "FFFFF6D6";
  let f = 6;
  cabeceraTabla(ws, f, ["Meta", "", ...MESES, "Año"]); f++;
  const bloques: { texto: string; hoja: string; fila?: string; tipo: "flujo" | "saldo"; menorEsMejor?: boolean; fmt?: string }[] = [
    { texto: "Colocación de crédito", hoja: "Colocación y cartera", fila: R["fila:col"], tipo: "flujo" },
    { texto: "Cartera bruta", hoja: "Colocación y cartera", fila: R["fila:br"], tipo: "saldo" },
    { texto: "Morosidad (máxima)", hoja: "Colocación y cartera", fila: R["fila:mo"], tipo: "saldo", menorEsMejor: true, fmt: PCT },
    { texto: "Captaciones (saldo)", hoja: "Captaciones", fila: R["fila:capS"], tipo: "saldo" },
    { texto: "Captación neta", hoja: "Captaciones", fila: R["fila:capN"], tipo: "flujo" },
    { texto: "Ingresos", hoja: "Estado de resultados", fila: R["fila:ing"], tipo: "flujo" },
    { texto: "Gastos (máximo)", hoja: "Estado de resultados", fila: R["fila:gas"], tipo: "flujo", menorEsMejor: true },
    { texto: "Resultado del ejercicio", hoja: "Estado de resultados", fila: R["fila:res"], tipo: "flujo" },
  ];
  for (const b of bloques) {
    if (!b.fila) continue;
    const fmt = b.fmt ?? NUM;
    const fM = f, fR = f + 1, fC = f + 2;
    ws.mergeCells(fM, 1, fC, 1);
    const t = ws.getCell(fM, 1); t.value = b.texto; t.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: VERDE } }; t.alignment = { vertical: "middle", indent: 1 };
    for (const [r, lab] of [[fM, "Meta"], [fR, "Real"], [fC, "Cumplimiento"]] as [number, string][]) {
      const c = ws.getCell(r, 2); c.value = lab; c.font = { name: "Segoe UI", size: 10, bold: r === fC, color: { argb: TEXTO } };
    }
    for (let i = 0; i < 12; i++) {
      const c = 3 + i, col = letra(c);
      formula(ws, fM, c, ref(b.hoja, `${col}${b.fila}`), null, fmt);
      const real = ws.getCell(fR, c); real.numFmt = fmt; real.fill = relleno(ENTRADA); real.font = { name: "Tahoma", size: 10, color: { argb: TEXTO } };
      real.protection = { locked: false };
      formula(ws, fC, c, b.menorEsMejor ? `IF(OR(${col}${fR}="",${col}${fR}=0),"",${col}${fM}/${col}${fR})` : `IF(OR(${col}${fR}="",${col}${fM}=0),"",${col}${fR}/${col}${fM})`, null, PCT, true);
    }
    // año: flujos = suma de los meses con dato; saldos = último mes con dato
    if (b.tipo === "flujo") {
      formula(ws, fM, 15, `SUM(C${fM}:N${fM})`, null, fmt, true);
      formula(ws, fR, 15, `IF(COUNT(C${fR}:N${fR})=0,"",SUM(C${fR}:N${fR}))`, null, fmt, true);
      formula(ws, fC, 15, `IF(O${fR}="","",IF(SUMPRODUCT((C${fR}:N${fR}<>"")*C${fM}:N${fM})=0,"",${b.menorEsMejor ? `SUMPRODUCT((C${fR}:N${fR}<>"")*C${fM}:N${fM})/O${fR}` : `O${fR}/SUMPRODUCT((C${fR}:N${fR}<>"")*C${fM}:N${fM})`}))`, null, PCT, true);
    } else {
      formula(ws, fM, 15, `N${fM}`, null, fmt, true);
      formula(ws, fR, 15, `IF(COUNT(C${fR}:N${fR})=0,"",LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fR}:N${fR}))`, null, fmt, true);
      formula(ws, fC, 15, `IF(O${fR}="","",IF(LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fM}:N${fM})=0,"",${b.menorEsMejor ? `LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fM}:N${fM})/O${fR}` : `O${fR}/LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fM}:N${fM})`}))`, null, PCT, true);
    }
    ws.getCell(fR, 15).fill = relleno(GRIS_SUAVE);
    for (let c = 1; c <= NC; c++) ws.getCell(fC, c).border = { bottom: { style: "medium", color: { argb: BORDE } } };
    f += 4;
  }
  // indicadores: meta (presupuesto), real (se ingresa) y diferencia en puntos porcentuales
  if (IND_SEGUIMIENTO.some((x) => R[`ind:${x.id}`])) {
    tituloBloque(ws, f, "Indicadores financieros", NC); f++;
    for (const x of IND_SEGUIMIENTO) {
      const fila = R[`ind:${x.id}`];
      if (!fila) continue;
      const fM = f, fR = f + 1, fD = f + 2;
      ws.mergeCells(fM, 1, fD, 1);
      const t = ws.getCell(fM, 1); t.value = x.texto; t.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: VERDE } }; t.alignment = { vertical: "middle", indent: 1 };
      for (const [r, lab] of [[fM, "Meta"], [fR, "Real"], [fD, "Diferencia"]] as [number, string][]) {
        const c = ws.getCell(r, 2); c.value = lab; c.font = { name: "Segoe UI", size: 10, bold: r === fD, color: { argb: TEXTO } };
      }
      for (let i = 0; i < 12; i++) {
        const c = 3 + i, col = letra(c);
        formula(ws, fM, c, ref("Indicadores", `${letra(2 + i)}${fila}`), null, PCT);
        const real = ws.getCell(fR, c); real.numFmt = PCT; real.fill = relleno(ENTRADA); real.font = { name: "Tahoma", size: 10, color: { argb: TEXTO } };
        real.protection = { locked: false };
        formula(ws, fD, c, `IF(${col}${fR}="","",${col}${fR}-${col}${fM})`, null, '+0.00%;-0.00%;0.00%', true);
      }
      formula(ws, fM, 15, `N${fM}`, null, PCT, true);
      formula(ws, fR, 15, `IF(COUNT(C${fR}:N${fR})=0,"",LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fR}:N${fR}))`, null, PCT, true);
      formula(ws, fD, 15, `IF(O${fR}="","",O${fR}-LOOKUP(2,1/(C${fR}:N${fR}<>""),C${fM}:N${fM}))`, null, '+0.00%;-0.00%;0.00%', true);
      ws.getCell(fR, 15).fill = relleno(GRIS_SUAVE);
      for (let c = 1; c <= NC; c++) ws.getCell(fD, c).border = { bottom: { style: "medium", color: { argb: BORDE } } };
      // diferencia favorable en verde, desfavorable en rojo
      ws.addConditionalFormatting({
        ref: `C${fD}:O${fD}`,
        rules: [
          { type: "expression", priority: 4, formulae: [`AND(ISNUMBER(C${fD}),C${fD}${x.menorEsMejor ? "<=" : ">="}0)`], style: { font: { color: { argb: "FF0B5A2A" } }, fill: relleno("FFE3EEE7") } },
          { type: "expression", priority: 5, formulae: [`AND(ISNUMBER(C${fD}),C${fD}${x.menorEsMejor ? ">" : "<"}0)`], style: { font: { color: { argb: "FF9B1C1C" } }, fill: relleno("FFFBE9E9") } },
        ] as unknown as ExcelJSNS.ConditionalFormattingRule[],
      });
      f += 4;
    }
  }
  // semáforo del cumplimiento: verde desde 100 %, ámbar desde 90 %, rojo debajo
  ws.addConditionalFormatting({
    ref: `C8:O${f}`,
    rules: [
      { type: "expression", priority: 1, formulae: ["AND($B8=\"Cumplimiento\",ISNUMBER(C8),C8>=1)"], style: { font: { color: { argb: "FF0B5A2A" } }, fill: relleno("FFE3EEE7") } },
      { type: "expression", priority: 2, formulae: ["AND($B8=\"Cumplimiento\",ISNUMBER(C8),C8>=0.9,C8<1)"], style: { font: { color: { argb: "FF8A5A12" } }, fill: relleno("FFFBF0D9") } },
      { type: "expression", priority: 3, formulae: ["AND($B8=\"Cumplimiento\",ISNUMBER(C8),C8<0.9)"], style: { font: { color: { argb: "FF9B1C1C" } }, fill: relleno("FFFBE9E9") } },
    ] as unknown as ExcelJSNS.ConditionalFormattingRule[],
  });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6, showGridLines: false }];
  imprimir(ws, "6:6");
}

/** Libro completo de metas de una agencia. */
export async function armarLibroMetas(ExcelJS: ExcelJS, d: DatosMetas): Promise<ExcelJSNS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.cooperativa;
  wb.title = `Presupuesto ${d.ejercicio} · Metas ${d.agencia}`;
  wb.calcProperties.fullCalcOnLoad = true;
  const R: Refs = {};
  const resumen = wb.addWorksheet("Resumen de metas", { properties: { tabColor: { argb: DORADO } } });
  hojaCartera(wb, d, R);
  hojaCaptaciones(wb, d, R);
  hojaAsesores(wb, d, R);
  hojaBalance(wb, d, R);
  hojaResultados(wb, d, R);
  hojaGastos(wb, d, R);
  const serie = serieIndicadores(d);
  if (serie) hojaIndicadores(wb, d, R, serie);
  hojaFlujo(wb, d);
  hojaSeguimiento(wb, d, R);
  hojaParametros(wb, d);
  hojaResumen(resumen, d, R);
  return wb;
}

type Pedir = (url: string) => Promise<unknown>;
const conError = (j: unknown, que: string) => {
  const e = (j as { error?: string } | null)?.error;
  if (e) throw new Error(`${que}: ${e}`);
  return j;
};

type TotalesCoop = NonNullable<DatosMetas["cooperativaTotales"]>;
const dic = (v?: number[]) => n(v?.[11]);
function totalesDe(cartera: DatosMetas["cartera"], captaciones: DatosMetas["captaciones"], balance: DatosMetas["balance"], resultados: DatosMetas["resultados"]): TotalesCoop {
  return {
    activo: dic(balance.activo?.valores),
    cartera: Object.values(cartera.detalle ?? {}).reduce((t, m) => t + n(m[11]?.porVencer.saldoFinal) + n(m[11]?.enRiesgo.saldoFinal), 0),
    captaciones: Object.values(captaciones.detalle ?? {}).reduce((t, m) => t + n(m[11]?.saldoFinal), 0),
    utilidad: dic(resultados.resultadoDelEjercicio?.valores),
  };
}

/** Totales de la cooperativa (Consolidado) a diciembre, para la participación de cada agencia. */
export async function totalesCooperativa(ejercicio: number, pedir: Pedir): Promise<TotalesCoop | null> {
  const q = `agencia=Consolidado&ejercicio=${ejercicio}`;
  try {
    const [c, k, b, r] = await Promise.all(["cartera-credito", "captaciones", "balance-general", "estado-resultados"].map((x) => pedir(`/api/${x}?${q}`).then((j) => conError(j, x))));
    return totalesDe(c as DatosMetas["cartera"], k as DatosMetas["captaciones"], b as DatosMetas["balance"], r as DatosMetas["resultados"]);
  } catch { return null; }
}

/** Reúne, con las mismas rutas que usan las pantallas, lo que necesita el libro de metas de una agencia. */
export async function reunirDatosMetas(agencia: string, ejercicio: number, pedir: Pedir, coop?: TotalesCoop | null): Promise<DatosMetas> {
  const q = `agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
  const [cartera, captaciones, balance, resultados, flujo, oficiales, metas, inst] = await Promise.all([
    pedir(`/api/cartera-credito?${q}`).then((j) => conError(j, "Cartera")),
    pedir(`/api/captaciones?${q}`).then((j) => conError(j, "Captaciones")),
    pedir(`/api/balance-general?${q}`).then((j) => conError(j, "Balance general")),
    pedir(`/api/estado-resultados?${q}`).then((j) => conError(j, "Estado de resultados")),
    pedir(`/api/flujo-efectivo?${q}`).then((j) => conError(j, "Flujo de efectivo")),
    pedir(`/api/oficiales-credito?${q}`).catch(() => null),
    pedir(`/api/metas-credito-institucional?ejercicio=${ejercicio}`).catch(() => null),
    pedir(`/api/parametros-institucionales?ejercicio=${ejercicio}`).catch(() => null),
  ]) as [DatosMetas["cartera"] & { corte?: { anio: number; mes: number } }, DatosMetas["captaciones"], DatosMetas["balance"], DatosMetas["resultados"], DatosMetas["flujo"],
    { oficiales?: { usuario: string; rango: string; activo: number }[] } | null, DatosMetas["metasRango"] & { error?: string } | null,
    { definiciones?: { clave: string; nombre: string; unidad: string; fuente?: string }[]; valores?: Record<string, { valor: number }> } | null];
  const corte = cartera.corte ?? { anio: ejercicio - 1, mes: 12 };
  const saldos = (await pedir(`/api/saldos-iniciales?${q}&anio=${corte.anio}&mes=${corte.mes}`).catch(() => null)) as { filas?: { codigo: string; saldo: number }[] } | null;
  return {
    cooperativa: "Cooperativa de Ahorro y Crédito Once de Junio Ltda.",
    agencia, ejercicio, corte, cartera, captaciones, balance, resultados, flujo,
    saldosCorte: Object.fromEntries((saldos?.filas ?? []).map((r) => [String(r.codigo), Number(r.saldo) || 0])),
    asesores: (oficiales?.oficiales ?? []).filter((o) => Number(o.activo ?? 1) === 1).map((o) => ({ usuario: String(o.usuario), rango: String(o.rango ?? "JUNIOR").toUpperCase() })),
    metasRango: metas && !metas.error ? metas : null,
    institucionales: (inst?.definiciones ?? []).map((p) => ({ nombre: p.nombre, unidad: p.unidad, valor: Number(inst?.valores?.[p.clave]?.valor ?? 0), fuente: p.fuente })),
    cooperativaTotales: agencia === "Consolidado" ? null : coop !== undefined ? coop : await totalesCooperativa(ejercicio, pedir),
  };
}
