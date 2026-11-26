"use client";
/**
 * Exportación de los Indicadores del presupuesto a Excel: una hoja por tipo de indicador, con la agencia elegida mes a
 * mes y, debajo, todas las agencias en el mes elegido.
 */
import { CATEGORIAS_PRESUPUESTO as CATEGORIAS, CONSOLIDADO, MESES, MESES_LARGO, valorDe, type Serie } from "./indicadores-categorias";

interface Opciones { ejercicio: number; mes: number; agencia: string; series: Record<string, Serie> }

const COOP = "Cooperativa de Ahorro y Crédito Once de Junio Ltda.";
const VERDE = "FF005A28", DORADO = "FFC38A03", VERDE_S = "FFE3EEE7", ROJO = "FFB42318", GRIS = "FF6B7570";
const USD = '#,##0;(#,##0);"–"', PCT = '0.00%;-0.00%;"–"';
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").replace(/Ñ/g, "N");

export async function exportarExcelIndicadores(o: Opciones) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = COOP;
  const relleno = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const fuente = (extra: object = {}) => ({ name: "Segoe UI", size: 10, ...extra });
  const serie = o.series[o.agencia];
  const agencias = [...Object.keys(o.series).filter((a) => a !== CONSOLIDADO), ...(o.series[CONSOLIDADO] ? [CONSOLIDADO] : [])];
  const cons = o.series[CONSOLIDADO];

  for (const cat of CATEGORIAS) {
    const ancho = 14;
    const ws = wb.addWorksheet(cat.label, { properties: { tabColor: { argb: VERDE } }, views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }] });
    ws.getColumn(1).width = 40;
    for (let c = 2; c <= ancho; c++) ws.getColumn(c).width = 13;
    ws.mergeCells(1, 1, 1, ancho); const t = ws.getCell(1, 1); t.value = COOP; t.font = fuente({ size: 13, bold: true, color: { argb: "FFFFFFFF" } }); t.fill = relleno(VERDE);
    for (let c = 1; c <= ancho; c++) ws.getCell(2, c).fill = relleno(DORADO); ws.getRow(2).height = 4;
    ws.mergeCells(3, 1, 3, ancho); const s = ws.getCell(3, 1); s.value = `Indicadores del presupuesto ${o.ejercicio} · ${cat.label}`; s.font = fuente({ size: 12, bold: true, color: { argb: VERDE } });
    ws.mergeCells(4, 1, 4, ancho); const p = ws.getCell(4, 1); p.value = `${o.agencia} · enero a diciembre de ${o.ejercicio}`; p.font = fuente({ color: { argb: GRIS } });

    const cabecera = (r: number, textos: string[]) => textos.forEach((x, k) => {
      const c = ws.getCell(r, k + 1); c.value = x; c.font = fuente({ bold: true, color: { argb: "FFFFFFFF" } }); c.fill = relleno(VERDE);
      c.alignment = { horizontal: k === 0 ? "left" : "center", vertical: "middle", wrapText: true };
    });
    const poner = (c: import("exceljs").Cell, v: number | null, formato: "pct" | "usd", negrita = false) => {
      c.value = v; c.numFmt = formato === "pct" ? PCT : USD;
      c.font = { name: "Tahoma", size: 10, bold: negrita, color: { argb: v !== null && v < 0 ? ROJO : "FF26302B" } };
    };

    // 1) la agencia elegida, mes a mes
    cabecera(6, ["Indicador", ...MESES]);
    let r = 7;
    for (const ind of cat.indicadores.filter((i) => !i.soloComparar)) {
      const nombre = ws.getCell(r, 1);
      nombre.value = { richText: [{ text: ind.label, font: fuente({ bold: true }) }, { text: `\n${ind.formula}`, font: fuente({ size: 8.5, color: { argb: GRIS } }) }] };
      nombre.alignment = { wrapText: true, vertical: "middle" };
      ws.getRow(r).height = 30;
      for (let m = 0; m < 12; m++) {
        const c = ws.getCell(r, m + 2);
        poner(c, valorDe(ind, serie, m, cons), ind.formato, m === o.mes);
        if (m === o.mes) c.fill = relleno(VERDE_S);
      }
      r++;
    }

    // 2) todas las agencias en el mes elegido
    r += 2;
    ws.mergeCells(r, 1, r, ancho); const t2 = ws.getCell(r, 1);
    t2.value = `Agencias a ${MESES_LARGO[o.mes]} de ${o.ejercicio}`; t2.font = fuente({ size: 12, bold: true, color: { argb: VERDE } });
    r += 1;
    cabecera(r, ["Agencia", ...cat.indicadores.map((i) => i.label)]);
    ws.getRow(r).height = 32;
    r++;
    for (const a of agencias) {
      const fuerte = a === CONSOLIDADO;
      ws.getCell(r, 1).value = a; ws.getCell(r, 1).font = fuente({ bold: fuerte });
      cat.indicadores.forEach((ind, k) => poner(ws.getCell(r, k + 2), valorDe(ind, o.series[a], o.mes, cons), ind.formato, fuerte));
      if (fuerte) for (let c = 1; c <= cat.indicadores.length + 1; c++) { ws.getCell(r, c).fill = relleno(VERDE_S); ws.getCell(r, c).border = { top: { style: "thin", color: { argb: VERDE } } }; }
      r++;
    }
  }

  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = sinTildes(`Indicadores ${o.ejercicio} - ${o.agencia} - ${MESES[o.mes]}.xlsx`);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
