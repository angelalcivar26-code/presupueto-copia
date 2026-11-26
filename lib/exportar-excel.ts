"use client";

import { ejercicioEnUso } from "./seleccion";

/**
 * EXPORTAR A EXCEL LO QUE SE VE EN PANTALLA.
 *
 * Toma las tablas visibles de la pantalla (las mismas filas, columnas, totales y grupos abiertos que
 * ve el usuario) y arma un .xlsx con encabezado de la cooperativa, cifras como números, negativos
 * entre paréntesis y títulos en negrita. Como sale de la propia tabla, lo exportado siempre coincide
 * con la pantalla. No consulta la base.
 */

type Celda = { v: string | number | null; fmt?: string; negrita: boolean; encabezado: boolean };

/** "1.234,56" · "(1.234)" · "−3,5 %" · "$12.000" → número (los % como fracción). */
function leerCifra(texto: string): { v: number; fmt: string } | null {
  let t = texto.replace(/ /g, " ").trim();
  if (!t || t === "—" || t === "-") return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1).trim(); }
  if (/^[−-]/.test(t)) { negativo = !negativo; t = t.slice(1).trim(); }
  if (t.startsWith("+")) t = t.slice(1).trim();
  if (/^\(.*\)$/.test(t)) { negativo = !negativo; t = t.slice(1, -1).trim(); }
  const pct = /%$/.test(t);
  t = t.replace(/%$/, "").replace(/^\$/, "").replace(/^USD\s*/i, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return null;
  const dec = t.includes(",") ? t.split(",")[1].length : 0;
  let n = Number(t.replace(/\./g, "").replace(",", "."));
  if (negativo) n = -n;
  if (pct) return { v: n / 100, fmt: `0${dec ? "." + "0".repeat(dec) : ""}%;(0${dec ? "." + "0".repeat(dec) : ""}%)` };
  return { v: n, fmt: dec ? `#,##0.${"0".repeat(dec)};(#,##0.${"0".repeat(dec)})` : "#,##0;(#,##0)" };
}

function textoCelda(c: HTMLElement): string {
  const campo = c.querySelector("input, select, textarea") as HTMLInputElement | HTMLSelectElement | null;
  if (campo && !(campo instanceof HTMLInputElement && campo.type === "checkbox")) {
    return campo instanceof HTMLSelectElement ? campo.selectedOptions[0]?.text ?? "" : campo.value;
  }
  // sin botones ni íconos (ƒ, editar, eliminar)
  const copia = c.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("button, svg, [aria-hidden='true']").forEach((x) => x.remove());
  return (copia.innerText ?? copia.textContent ?? "").replace(/\s+/g, " ").trim();
}

const visible = (el: HTMLElement) => !!(el.offsetParent || el.getClientRects().length);

/** Título de la tarjeta que contiene la tabla (si lo hay). */
function tituloDeTabla(tabla: HTMLTableElement): string | null {
  let nodo: HTMLElement | null = tabla.parentElement;
  for (let i = 0; i < 5 && nodo && nodo.tagName !== "MAIN"; i++, nodo = nodo.parentElement) {
    const cand = Array.from(nodo.querySelectorAll<HTMLElement>("h2, h3, p, span, div"))
      .find((e) => !e.contains(tabla) && !tabla.contains(e) && e.children.length === 0 && /font-(semibold|bold)/.test(e.className)
        && (e.textContent ?? "").trim().length > 2 && (e.textContent ?? "").trim().length < 90
        && (e.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    if (cand) return cand.textContent!.trim();
  }
  return null;
}

function filasDeTabla(tabla: HTMLTableElement): Celda[][] {
  const filas: Celda[][] = [];
  for (const tr of Array.from(tabla.rows)) {
    if (!visible(tr)) continue;
    const fila: Celda[] = [];
    for (const c of Array.from(tr.cells)) {
      const texto = textoCelda(c);
      const cifra = leerCifra(texto);
      const peso = Number(getComputedStyle(c).fontWeight) || 400;
      const pesoHijo = c.firstElementChild ? Number(getComputedStyle(c.firstElementChild).fontWeight) || 400 : 400;
      const encabezado = c.tagName === "TH" || tr.parentElement?.tagName === "THEAD";
      const celda: Celda = { v: cifra ? cifra.v : texto || null, fmt: cifra?.fmt, negrita: encabezado || Math.max(peso, pesoHijo) >= 600, encabezado };
      fila.push(celda);
      for (let k = 1; k < c.colSpan; k++) fila.push({ v: null, negrita: celda.negrita, encabezado });
    }
    if (fila.some((x) => x.v !== null && x.v !== "")) filas.push(fila);
  }
  // Códigos de cuenta: se quedan como texto (no como número)
  const cab = filas.find((f) => f.some((c) => c.encabezado));
  cab?.forEach((c, j) => {
    if (typeof c.v === "string" && /c[óo]digo/i.test(c.v)) {
      for (const f of filas) if (f[j] && typeof f[j].v === "number") { f[j].v = String(f[j].v); f[j].fmt = undefined; }
    }
  });
  // fuera las columnas vacías (ƒ, acciones)
  const ancho = Math.max(0, ...filas.map((f) => f.length));
  const usadas = Array.from({ length: ancho }, (_, j) => filas.some((f) => f[j] && f[j].v !== null && f[j].v !== "" && !(f[j].encabezado && !filas.some((g) => !g[j]?.encabezado && g[j]?.v !== null && g[j]?.v !== ""))));
  return filas.map((f) => f.filter((_, j) => usadas[j]));
}

/** Descarga en Excel las tablas visibles de la pantalla. */
export async function exportarPantalla(opc: { titulo?: string; agencia?: string; ejercicio?: number } = {}): Promise<void> {
  const opciones = { ...opc, ejercicio: opc.ejercicio ?? ejercicioEnUso() };
  const main = document.querySelector("main");
  if (!main) return;
  const tablas = Array.from(main.querySelectorAll<HTMLTableElement>("table")).filter(visible);
  if (!tablas.length) return;
  const h1 = main.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "Presupuesto";
  const titulo = opciones.titulo ?? h1;
  const agencia = opciones.agencia
    ?? Array.from(main.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.value === "Consolidado" || o.value === "Matriz"))?.value;

  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = "Once de Junio";
  const hoja = libro.addWorksheet(titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), {
    views: [{ showGridLines: false }],
    // Al imprimir: horizontal y todas las columnas en el ancho de la hoja
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  hoja.addRow(["Cooperativa de Ahorro y Crédito Once de Junio Ltda."]).font = { bold: true, size: 12, color: { argb: "FF005A28" } };
  hoja.addRow([titulo]).font = { bold: true, size: 11 };
  const fecha = new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" });
  hoja.addRow([[agencia ? `Agencia: ${agencia}` : null, opciones.ejercicio ? `Ejercicio ${opciones.ejercicio}` : null, `Generado: ${fecha}`].filter(Boolean).join(" · ")]).font = { size: 9, color: { argb: "FF6B7570" } };

  const anchos: number[] = [];
  for (const tabla of tablas) {
    const filas = filasDeTabla(tabla);
    if (!filas.length) continue;
    hoja.addRow([]);
    const sub = tablas.length > 1 ? tituloDeTabla(tabla) : null;
    if (sub) hoja.addRow([sub]).font = { bold: true, size: 10, color: { argb: "FF005A28" } };
    // columnas con cifras (para alinear su encabezado a la derecha)
    const numericas = new Set<number>();
    for (const f of filas) f.forEach((c, j) => { if (!c.encabezado && typeof c.v === "number") numericas.add(j); });
    for (const f of filas) {
      const r = hoja.addRow(f.map((c) => c.v));
      f.forEach((c, j) => {
        const cel = r.getCell(j + 1);
        cel.font = { name: "Calibri", size: 10, bold: c.negrita };
        if (c.fmt) cel.numFmt = c.fmt;
        if (typeof c.v === "number" || numericas.has(j)) cel.alignment = { horizontal: "right" };
        if (c.encabezado) {
          cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F2" } };
          cel.border = { bottom: { style: "thin", color: { argb: "FFD5DBD7" } } };
        }
        const largo = typeof c.v === "number" ? 14 : Math.min(60, String(c.v ?? "").length + 2);
        anchos[j] = Math.max(anchos[j] ?? 10, largo);
      });
    }
  }
  anchos.forEach((w, j) => { hoja.getColumn(j + 1).width = w; });

  const buf = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${titulo.replace(/\s*·\s*\d{4}$/, "")}${agencia ? ` - ${agencia}` : ""}${opciones.ejercicio ? ` - ${opciones.ejercicio}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
