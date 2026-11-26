"use client";
/**
 * Exportación de la Ejecución presupuestaria: Excel (tablas con fórmulas y agrupación por niveles) e informe Word
 * para Gerencia (resumen, principales variaciones y estados financieros comparados).
 */
import type { FilaEjecucion } from "./ejecucion";
import { GRUPOS, compararInd, fraseIndicador, pp, principalesIndicadores, type DatosIndicadores } from "./indicadores-ejecucion";
import { pct } from "./indicadores-categorias";
import { MESES, MESES_LARGO, aplanar, buscar, comparar, frase, pctTxt, principales, usd, type Base } from "./ejecucion-calc";

interface Opciones { agencia: string; ejercicio: number; mes: number; base: Base; datos: { meses: number[]; bal: FilaEjecucion[]; er: FilaEjecucion[]; indicadores?: DatosIndicadores } }

const COOP = "Cooperativa de Ahorro y Crédito Once de Junio Ltda.";
const VERDE = "FF005A28", DORADO = "FFC38A03", VERDE_S = "FFE3EEE7", GRIS_S = "FFF4F6F5", OK = "FF2E8B57", MAL = "FFC0392B";
const NUM = '#,##0.00;(#,##0.00);"–"', PCT = '0.0%;(0.0%);"–"';

/** Nombre de archivo sin tildes ni ñ (algunos navegadores los descartan al descargar). */
const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, "n").replace(/Ñ/g, "N");

function guardar(blob: Blob, nombre: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = sinTildes(nombre);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const periodoTxt = (o: Opciones, er: boolean) => er
  ? (o.base === "acumulado" ? `acumulado a ${MESES_LARGO[o.mes - 1]} de ${o.ejercicio}` : `${MESES_LARGO[o.mes - 1]} de ${o.ejercicio}`)
  : `al cierre de ${MESES_LARGO[o.mes - 1]} de ${o.ejercicio}`;

// ---------------------------------------------------------------- Excel
export async function exportarExcelEjecucion(o: Opciones) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = COOP; wb.calcProperties.fullCalcOnLoad = true;
  const relleno = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const i = o.mes - 1;

  const hoja = (nombre: string, filas: FilaEjecucion[], er: boolean) => {
    const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: VERDE } }, views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    [12, 46, 18, 18, 18, 11, 12].forEach((w, k) => (ws.getColumn(k + 1).width = w));
    ws.mergeCells(1, 1, 1, 7); const t = ws.getCell(1, 1); t.value = COOP; t.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: "FFFFFFFF" } }; t.fill = relleno(VERDE);
    for (let c = 1; c <= 7; c++) ws.getCell(2, c).fill = relleno(DORADO); ws.getRow(2).height = 4;
    ws.mergeCells(3, 1, 3, 7); const s = ws.getCell(3, 1); s.value = `Ejecución presupuestaria · ${nombre} · ${o.agencia}`; s.font = { name: "Segoe UI", size: 12, bold: true, color: { argb: VERDE } };
    ws.mergeCells(4, 1, 4, 7); const p = ws.getCell(4, 1); p.value = `Presupuesto frente a real ${periodoTxt(o, er)} · USD`; p.font = { name: "Segoe UI", size: 10, color: { argb: "FF6B7570" } };
    const cab = ["Código", "Cuenta", "Presupuesto", "Real", "Variación", "Var. %", "Cumplimiento"];
    cab.forEach((x, k) => { const c = ws.getCell(6, k + 1); c.value = x; c.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = relleno(VERDE); c.alignment = { horizontal: k < 2 ? "left" : "center" }; });
    let r = 7;
    for (const { f, nivel } of aplanar(filas)) {
      const c = comparar(f, i, er, o.base);
      const row = ws.getRow(r);
      row.outlineLevel = Math.min(nivel, 7);
      row.getCell(1).value = /^\d+$/.test(f.codigo) ? f.codigo : ""; row.getCell(2).value = f.label;
      row.getCell(2).alignment = { indent: nivel };
      if (f.pres) row.getCell(3).value = c.pres;
      row.getCell(4).value = c.real;
      if (f.pres && c.real !== null) {
        row.getCell(5).value = { formula: `D${r}-C${r}`, result: c.dif ?? undefined };
        row.getCell(6).value = { formula: `IF(C${r}=0,"",E${r}/ABS(C${r}))`, result: c.pct ?? undefined };
        row.getCell(7).value = { formula: f.menos ? `IF(OR(C${r}=0,D${r}=0),"",C${r}/D${r})` : `IF(OR(C${r}=0,D${r}=0),"",D${r}/C${r})`, result: c.cumpl ?? undefined };
        const col = c.favorable ? OK : MAL;
        for (const k of [5, 6]) row.getCell(k).font = { name: "Tahoma", size: 10, bold: true, color: { argb: col } };
        row.getCell(7).fill = relleno(c.cumpl === null ? "FFFFFFFF" : c.cumpl >= 1 ? "FFE3EEE7" : c.cumpl >= 0.9 ? "FFFBF0D9" : "FFFBE9E9");
      }
      for (const k of [3, 4, 5]) row.getCell(k).numFmt = NUM;
      row.getCell(6).numFmt = PCT; row.getCell(7).numFmt = PCT;
      const negrita = nivel === 0;
      for (const k of [1, 2, 3, 4]) row.getCell(k).font = { name: k === 2 ? "Segoe UI" : "Tahoma", size: 10, bold: negrita, color: { argb: negrita ? VERDE : f.pres ? "FF26302B" : "FF6B7570" } };
      if (negrita) for (let k = 1; k <= 7; k++) row.getCell(k).fill = row.getCell(k).fill ?? relleno(VERDE_S);
      for (let k = 1; k <= 7; k++) row.getCell(k).border = { bottom: { style: "thin", color: { argb: "FFE3E6E4" } } };
      r++;
    }
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "6:6" };
  };
  hoja("Balance general", o.datos.bal, false);
  hoja("Estado de resultados", o.datos.er, true);

  // Indicadores: presupuesto frente a real del mes, diferencia en puntos porcentuales
  if (o.datos.indicadores) {
    const D = o.datos.indicadores;
    const ws = wb.addWorksheet("Indicadores", { properties: { tabColor: { argb: VERDE } }, views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
    [44, 16, 16, 18].forEach((w, k) => (ws.getColumn(k + 1).width = w));
    ws.mergeCells(1, 1, 1, 4); const t = ws.getCell(1, 1); t.value = COOP; t.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: "FFFFFFFF" } }; t.fill = relleno(VERDE);
    for (let c = 1; c <= 4; c++) ws.getCell(2, c).fill = relleno(DORADO); ws.getRow(2).height = 4;
    ws.mergeCells(3, 1, 3, 4); const s3 = ws.getCell(3, 1); s3.value = `Ejecución presupuestaria · Indicadores · ${o.agencia}`; s3.font = { name: "Segoe UI", size: 12, bold: true, color: { argb: VERDE } };
    ws.mergeCells(4, 1, 4, 4); const s4 = ws.getCell(4, 1); s4.value = `Presupuesto frente a real a ${MESES_LARGO[i]} de ${o.ejercicio}`; s4.font = { name: "Segoe UI", size: 10, color: { argb: "FF6B7570" } };
    ["Indicador", "Presupuesto", "Real", "Diferencia (pp)"].forEach((x, k) => { const c = ws.getCell(6, k + 1); c.value = x; c.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = relleno(VERDE); c.alignment = { horizontal: k ? "center" : "left" }; });
    let r = 7;
    for (const g of GRUPOS) {
      const h = ws.getCell(r, 1); h.value = g.label; h.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: VERDE } };
      for (let c = 1; c <= 4; c++) ws.getCell(r, c).fill = relleno(VERDE_S);
      r++;
      for (const ind of g.indicadores) {
        const c = compararInd(ind, D, i);
        ws.getCell(r, 1).value = ind.label; ws.getCell(r, 1).font = { name: "Segoe UI", size: 10 }; ws.getCell(r, 1).alignment = { indent: 1 };
        for (const [k, v] of [[2, c.pres], [3, c.real]] as [number, number | null][]) { const x = ws.getCell(r, k); x.value = v; x.numFmt = '0.00%;-0.00%;"–"'; x.font = { name: "Tahoma", size: 10 }; }
        if (c.dif !== null) {
          const x = ws.getCell(r, 4); x.value = { formula: `(C${r}-B${r})*100`, result: c.dif * 100 }; x.numFmt = '+0.00" pp";-0.00" pp";0.00" pp"';
          x.font = { name: "Tahoma", size: 10, bold: true, color: { argb: c.favorable ? OK : MAL } };
        }
        for (let k = 1; k <= 4; k++) ws.getCell(r, k).border = { bottom: { style: "thin", color: { argb: "FFE3E6E4" } } };
        r++;
      }
    }
    ws.pageSetup = { orientation: "portrait", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "6:6" };
  }

  // Año: cumplimiento por mes (mapa de calor)
  for (const [nombre, filas, er] of [["Año - Balance", o.datos.bal, false], ["Año - Resultados", o.datos.er, true]] as [string, FilaEjecucion[], boolean][]) {
    const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: DORADO } }, views: [{ state: "frozen", xSplit: 2, ySplit: 5, showGridLines: false }] });
    ws.getColumn(1).width = 12; ws.getColumn(2).width = 44; for (let k = 0; k < 12; k++) ws.getColumn(3 + k).width = 9;
    ws.mergeCells(1, 1, 1, 14); const t = ws.getCell(1, 1); t.value = COOP; t.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: "FFFFFFFF" } }; t.fill = relleno(VERDE);
    ws.mergeCells(2, 1, 2, 14); const s = ws.getCell(2, 1); s.value = `Cumplimiento mensual ${o.ejercicio} · ${nombre.replace("Año - ", "")} · ${o.agencia}${er ? ` · ${o.base === "acumulado" ? "acumulado" : "movimiento del mes"}` : ""}`; s.font = { name: "Segoe UI", size: 12, bold: true, color: { argb: VERDE } };
    ["Código", "Cuenta", ...MESES].forEach((x, k) => { const c = ws.getCell(5, k + 1); c.value = x; c.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = relleno(VERDE); c.alignment = { horizontal: k < 2 ? "left" : "center" }; });
    let r = 6;
    for (const { f, nivel } of aplanar(filas).filter((x) => x.f.pres)) {
      const row = ws.getRow(r); row.outlineLevel = Math.min(nivel, 7);
      row.getCell(1).value = /^\d+$/.test(f.codigo) ? f.codigo : ""; row.getCell(2).value = f.label; row.getCell(2).alignment = { indent: nivel };
      row.getCell(1).font = row.getCell(2).font = { name: "Segoe UI", size: 10, bold: nivel === 0, color: { argb: nivel === 0 ? VERDE : "FF26302B" } };
      for (let k = 0; k < 12; k++) {
        if (!o.datos.meses.includes(k + 1)) continue;
        const c = comparar(f, k, er, o.base), cel = row.getCell(3 + k);
        if (c.cumpl === null) continue;
        cel.value = c.cumpl; cel.numFmt = '0.0%'; cel.alignment = { horizontal: "center" };
        cel.fill = relleno(c.cumpl >= 1 ? "FFE3EEE7" : c.cumpl >= 0.9 ? "FFFBF0D9" : "FFFBE9E9");
        cel.font = { name: "Tahoma", size: 9, bold: true, color: { argb: c.cumpl >= 1 ? "FF0B5A2A" : c.cumpl >= 0.9 ? "FF8A5A12" : "FF9B1C1C" } };
      }
      r++;
    }
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
  }
  const buf = await wb.xlsx.writeBuffer();
  guardar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Ejecución ${o.ejercicio} - ${o.agencia} - ${MESES[o.mes - 1]}.xlsx`);
}

// ---------------------------------------------------------------- Word
export async function exportarWordEjecucion(o: Opciones) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, ShadingType, BorderStyle, PageOrientation, Footer, PageNumber } = d;
  const i = o.mes - 1;
  const fuente = "Segoe UI";
  const ANCHO_UTIL = 9706; // A4 (11906) menos los márgenes de 1100, en twips
  const p = (text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new Paragraph({ alignment: align, spacing: { after: 120 }, children: [new TextRun({ text, font: fuente, size: opts.size ?? 21, bold: opts.bold, color: opts.color, italics: opts.italics })] });
  const titulo = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: fuente, size: 28, bold: true, color: "005A28" })] });
  const borde = { style: BorderStyle.SINGLE, size: 4, color: "E3E6E4" };
  const celda = (text: string, o2: { bold?: boolean; color?: string; fondo?: string; der?: boolean; ancho?: number; blanco?: boolean } = {}) => new TableCell({
    width: o2.ancho ? { size: Math.round(o2.ancho * ANCHO_UTIL / 100), type: WidthType.DXA } : undefined,
    shading: o2.fondo ? { type: ShadingType.CLEAR, color: "auto", fill: o2.fondo } : undefined,
    borders: { top: borde, bottom: borde, left: borde, right: borde },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: o2.der ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, font: o2.der ? "Tahoma" : fuente, size: 17, bold: o2.bold, color: o2.blanco ? "FFFFFF" : o2.color })] })],
  });
  const cabecera = (cols: string[], anchos: number[]) => new TableRow({ tableHeader: true, children: cols.map((c, k) => celda(c, { bold: true, blanco: true, fondo: "005A28", der: k > 1, ancho: anchos[k] })) });

  const tablaEstado = (filas: FilaEjecucion[], er: boolean) => {
    const anchos = [9, 32, 16, 16, 16, 11];
    const rows = [cabecera(["Código", "Cuenta", "Presupuesto", "Real", "Variación", "Var. %"], anchos)];
    for (const { f, nivel } of aplanar(filas, 0, 2).filter((x) => x.f.pres && (x.f.codigo.length <= 4 || !/^\d+$/.test(x.f.codigo)))) {
      const c = comparar(f, i, er, o.base), raiz = nivel === 0, col = c.favorable === null ? undefined : c.favorable ? "2E8B57" : "C0392B";
      rows.push(new TableRow({ children: [
        celda(/^\d+$/.test(f.codigo) ? f.codigo : "", { bold: raiz, fondo: raiz ? "E3EEE7" : undefined }),
        celda(`${"   ".repeat(nivel)}${f.label}`, { bold: raiz, fondo: raiz ? "E3EEE7" : undefined, color: raiz ? "005A28" : undefined }),
        celda(usd(c.pres), { der: true, bold: raiz, fondo: raiz ? "E3EEE7" : undefined }),
        celda(usd(c.real), { der: true, bold: raiz, fondo: raiz ? "E3EEE7" : undefined }),
        celda(usd(c.dif), { der: true, bold: true, color: col, fondo: raiz ? "E3EEE7" : undefined }),
        celda(pctTxt(c.pct), { der: true, bold: true, color: col, fondo: raiz ? "E3EEE7" : undefined }),
      ] }));
    }
    return new Table({ width: { size: ANCHO_UTIL, type: WidthType.DXA }, columnWidths: anchos.map((a) => Math.round(a * ANCHO_UTIL / 100)), layout: d.TableLayoutType.FIXED, rows });
  };

  const resumenFilas: [string, FilaEjecucion | null, boolean][] = [
    ["Activo total", buscar(o.datos.bal, (f) => f.codigo === "1"), false],
    ["Cartera de créditos", buscar(o.datos.bal, (f) => f.codigo === "14"), false],
    ["Captaciones (obligaciones con el público)", buscar(o.datos.bal, (f) => f.codigo === "21"), false],
    ["Patrimonio", buscar(o.datos.bal, (f) => f.codigo === "3"), false],
    ["Ingresos", buscar(o.datos.er, (f) => f.codigo === "5"), true],
    ["Gastos", buscar(o.datos.er, (f) => f.codigo === "4"), true],
    ["Resultado del ejercicio", buscar(o.datos.er, (f) => f.id === "resultado"), true],
  ];
  const anchosR = [40, 18, 18, 14, 10];
  const resumen = new Table({ width: { size: ANCHO_UTIL, type: WidthType.DXA }, columnWidths: anchosR.map((a) => Math.round(a * ANCHO_UTIL / 100)), layout: d.TableLayoutType.FIXED, rows: [
    cabecera(["Indicador", "Presupuesto", "Real", "Variación", "Cumpl."], anchosR),
    ...resumenFilas.filter(([, f]) => f).map(([t, f, er]) => {
      const c = comparar(f!, i, er, o.base), col = c.favorable ? "2E8B57" : "C0392B";
      return new TableRow({ children: [celda(t, { bold: true }), celda(usd(c.pres), { der: true }), celda(usd(c.real), { der: true }), celda(usd(c.dif), { der: true, bold: true, color: col }), celda(c.cumpl === null ? "—" : pctTxt(c.cumpl, false), { der: true, bold: true, color: col })] });
    }),
  ] });

  const vinetas = (filas: FilaEjecucion[], er: boolean) => principales(filas, i, er, o.base, 6).map(({ f, c }) => new Paragraph({
    bullet: { level: 0 }, spacing: { after: 80 },
    children: [new TextRun({ text: frase(f, c), font: fuente, size: 20, color: c.favorable ? "1E6B43" : "9B1C1C" })],
  }));

  // 3. Indicadores financieros: presupuesto frente a real y principales desvíos
  const seccionIndicadores = () => {
    const D = o.datos.indicadores;
    if (!D || !D.real[i]) return [];
    const anchosI = [46, 18, 18, 18];
    const filas = [cabecera(["Indicador", "Presupuesto", "Real", "Diferencia"], anchosI)];
    for (const g of GRUPOS) {
      filas.push(new TableRow({ children: [celda(g.label, { bold: true, color: "005A28", fondo: "E3EEE7", ancho: anchosI[0] }), ...[1, 2, 3].map((k) => celda("", { fondo: "E3EEE7", ancho: anchosI[k] }))] }));
      for (const ind of g.indicadores) {
        const c = compararInd(ind, D, i), col = c.favorable === null ? undefined : c.favorable ? "2E8B57" : "C0392B";
        filas.push(new TableRow({ children: [celda(`   ${ind.label}`, { ancho: anchosI[0] }), celda(pct(c.pres), { der: true, ancho: anchosI[1] }), celda(pct(c.real), { der: true, ancho: anchosI[2] }), celda(pp(c.dif), { der: true, bold: true, color: col, ancho: anchosI[3] })] }));
      }
    }
    const tabla = new Table({ width: { size: ANCHO_UTIL, type: WidthType.DXA }, columnWidths: anchosI.map((a) => Math.round(a * ANCHO_UTIL / 100)), layout: d.TableLayoutType.FIXED, rows: filas });
    const desvios = principalesIndicadores(D, i, 6).map(({ ind, c }) => new Paragraph({
      bullet: { level: 0 }, spacing: { after: 80 },
      children: [new TextRun({ text: fraseIndicador(ind, c), font: fuente, size: 20, color: c.favorable ? "1E6B43" : "9B1C1C" })],
    }));
    return [
      titulo("3. Indicadores financieros"),
      p(`Indicadores presupuestados frente a los reales a ${MESES_LARGO[i]} de ${o.ejercicio}. Diferencia en puntos porcentuales.`, { color: "4A554F" }),
      ...(desvios.length ? [p("Principales desvíos", { bold: true, color: "005A28" }), ...desvios] : []),
      tabla,
    ];
  };

  const doc = new Document({
    creator: COOP, title: `Ejecución presupuestaria ${o.agencia} ${MESES_LARGO[i]} ${o.ejercicio}`,
    styles: { default: { document: { run: { font: fuente, size: 21 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT }, margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${COOP} · Página `, font: fuente, size: 16, color: "6B7570" }), new TextRun({ children: [PageNumber.CURRENT], font: fuente, size: 16, color: "6B7570" })] })] }) },
      children: [
        p(COOP, { bold: true, size: 26, color: "005A28" }),
        p(`Informe de ejecución presupuestaria · ${o.agencia}`, { bold: true, size: 32 }),
        p(`Período: ${MESES_LARGO[i]} de ${o.ejercicio} · Presupuesto ${o.ejercicio} frente a cifras reales`, { size: 21, color: "4A554F" }),
        p("Dirigido a: Gerencia General", { size: 21, color: "4A554F" }),
        titulo("1. Resumen"),
        p(`Cifras del balance al cierre de ${MESES_LARGO[i]}; cifras de resultados ${o.base === "acumulado" ? `acumuladas de enero a ${MESES_LARGO[i]}` : `del mes de ${MESES_LARGO[i]}`}. Valores en dólares.`, { color: "4A554F" }),
        resumen,
        titulo("2. Principales variaciones"),
        p("Balance general", { bold: true, color: "005A28" }),
        ...vinetas(o.datos.bal, false),
        p("Estado de resultados", { bold: true, color: "005A28" }),
        ...vinetas(o.datos.er, true),
        ...seccionIndicadores(),
        titulo(`${o.datos.indicadores ? 4 : 3}. Análisis y explicaciones`),
        p("[Explicación de las variaciones más relevantes y acciones propuestas]", { italics: true, color: "6B7570" }),
        titulo(`${o.datos.indicadores ? 5 : 4}. Balance general comparado`),
        tablaEstado(o.datos.bal, false),
        titulo(`${o.datos.indicadores ? 6 : 5}. Estado de resultados comparado`),
        tablaEstado(o.datos.er, true),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  guardar(blob, `Informe de ejecución ${o.ejercicio} - ${o.agencia} - ${MESES[i]}.docx`);
}
