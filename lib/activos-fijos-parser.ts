/**
 * Lector del reporte "DEPRECIACIÓN DE ACTIVOS FIJOS" tal como sale del sistema.
 *
 * Limpia el archivo solo:
 *  - Busca la fila de títulos por su NOMBRE (no por posición): funciona aunque
 *    el reporte traiga columnas extra, en otro orden, o filas adicionales arriba.
 *  - Toma la fecha de corte de "FECHA CALCULO: ..." en el encabezado.
 *  - Completa hacia abajo la OFICINA (el sistema solo la escribe en el primer bien).
 *  - Descarta las filas de "SUMA ...", "TOTAL ..." y "Total General".
 *  - Traduce la oficina al nombre de la tabla `agencias` y la cuenta a su categoría.
 *  - Valida contra la fila "Total General" del propio reporte.
 *
 * Es una función pura (no toca la base de datos): recibe las filas crudas de la hoja.
 */

export interface BienActivoFijo {
  agencia: string;            // nombre exacto de la tabla agencias
  codigo_activo: string;      // 18060505-0123
  cuenta_codigo: string;      // 18060505
  categoria: string;          // mismos nombres que factores_depreciacion
  descripcion: string;
  fecha_adquisicion: string | null; // AAAA-MM-DD
  fecha_activacion: string;         // AAAA-MM-DD
  valor_contable: number;
  valor_historico: number;
  valor_residual: number;
  vida_util_meses: number;
  dep_acumulada: number;
  dep_mensual: number;
}

export interface ResultadoParseoActivos {
  fechaCorte: string | null;
  bienes: BienActivoFijo[];
  totalGeneral: { contable: number; depAcumulada: number; depMensual: number; bienes: number } | null;
  errores: string[];
  advertencias: string[];
}

// ---------------------------------------------------------------------------

const MAPA_OFICINAS: Record<string, string> = {
  "MATRIZ": "Matriz",
  "EL GUABO": "El Guabo", "GUABO": "El Guabo",
  "PINAS": "Piñas",
  "MACHALA II": "Machala II", "MACHALA 2": "Machala II",
  "PONCE ENRIQUEZ": "Ponce Enríquez",
  "BALSAS": "Balsas",
  "SANTA ROSA": "Santa Rosa",
  "LAS LAJAS": "Las Lajas",
  "NARANJAL": "Naranjal",
  "CATAMAYO": "Catamayo",
};

/** Mayúsculas, sin tildes, sin espacios dobles. */
function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function normalizarOficinaActivos(texto: unknown): string | null {
  return MAPA_OFICINAS[norm(texto)] ?? null;
}

/** Categoría según la cuenta contable de costo (1801 Terrenos, 1802 Edificios, 18050501 Muebles...). */
function categoriaPorCuenta(cuenta: string): string | null {
  if (cuenta.startsWith("1801")) return "Terrenos";
  if (cuenta.startsWith("1802")) return "Edificios";
  if (cuenta.startsWith("18050501")) return "Muebles de oficina";
  if (cuenta.startsWith("18050502")) return "Equipo de oficina";
  if (cuenta.startsWith("18050503")) return "Enseres de Oficina";
  if (cuenta.startsWith("1806")) return "Equipos de Computación";
  if (cuenta.startsWith("1807")) return "Unidades de Transporte";
  if (cuenta.startsWith("1890")) return "Otros Activos";
  return null;
}

function numero(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    // Acepta "1.234,56" y "1,234.56"
    const limpio = t.includes(",") && t.lastIndexOf(",") > t.lastIndexOf(".")
      ? t.replace(/\./g, "").replace(",", ".")
      : t.replace(/,/g, "");
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function aISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Fecha desde Date, número de serie de Excel o texto (AAAA-MM-DD / DD-MM-AAAA / DD/MM/AAAA). */
function fecha(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return aISO(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const t = v.trim();
    let m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// Nombres de columna aceptados (ya normalizados). Se toma la primera que coincida.
const COLUMNAS = {
  oficina: ["OFICINA", "AGENCIA"],
  codigo: ["CODIGO", "CODIGO ACTIVO"],
  descripcion: ["DESCRIPCION"],
  estado: ["ESTADO"],
  fecAdq: ["FEC. ADQUIS.", "FEC ADQUIS", "FECHA ADQUISICION", "FEC. ADQUISICION"],
  fecAct: ["FEC. ACTIVAC.", "FEC ACTIVAC", "FECHA ACTIVACION", "FEC. ACTIVACION"],
  contable: ["VALOR CONTABLE"],
  residual: ["VALOR RESIDUAL"],
  libros: ["VALOR LIBROS", "VALOR EN LIBROS"],
  historico: ["VALOR HISTORICO"],
  depAcum: ["DEP. ACUMUL.", "DEP ACUMUL", "DEPRECIACION ACUMULADA", "DEP. ACUMULADA"],
  depMes: ["DEP. MENSUAL", "DEP MENSUAL", "DEPRECIACION MENSUAL"],
  vidaMeses: ["DEPREC. (MESES)", "DEPREC (MESES)", "VIDA UTIL (MESES)", "VIDA UTIL MESES"],
  vidaAnios: ["ANOS VIDA UTIL", "AÑOS VIDA UTIL"],
} as const;
type Col = keyof typeof COLUMNAS;
const OBLIGATORIAS: Col[] = ["oficina", "codigo", "fecAct", "contable", "depAcum", "depMes"];

// ---------------------------------------------------------------------------

export function parsearActivosFijos(filas: unknown[][]): ResultadoParseoActivos {
  const errores: string[] = [];
  const advertencias: string[] = [];

  // 1) Fecha de corte en las primeras filas: "FECHA CALCULO: 2026-08-31"
  let fechaCorte: string | null = null;
  for (const fila of filas.slice(0, 15)) {
    for (const celda of fila ?? []) {
      const t = norm(celda);
      if (t.startsWith("FECHA CALCULO")) {
        fechaCorte = fecha(t.replace(/^FECHA CALCULO\s*:?\s*/, ""));
        if (fechaCorte) break;
      }
    }
    if (fechaCorte) break;
  }
  if (!fechaCorte) errores.push('No se encontró la fecha de corte ("FECHA CALCULO: ...") en el encabezado del reporte.');

  // 2) Fila de títulos: la primera que tenga CODIGO y DESCRIPCION
  const iTitulos = filas.findIndex((f) => {
    const n = (f ?? []).map(norm);
    return n.includes("CODIGO") && n.includes("DESCRIPCION");
  });
  if (iTitulos < 0) {
    errores.push("No se encontró la fila de títulos (CODIGO, DESCRIPCION, ...). ¿Es el reporte de Depreciación de Activos Fijos?");
    return { fechaCorte, bienes: [], totalGeneral: null, errores, advertencias };
  }
  const titulos = (filas[iTitulos] ?? []).map(norm);
  const idx: Partial<Record<Col, number>> = {};
  (Object.keys(COLUMNAS) as Col[]).forEach((c) => {
    const i = titulos.findIndex((t) => (COLUMNAS[c] as readonly string[]).includes(t));
    if (i >= 0) idx[c] = i;
  });
  const faltan = OBLIGATORIAS.filter((c) => idx[c] === undefined);
  if (faltan.length) {
    errores.push(`Faltan columnas obligatorias en el reporte: ${faltan.map((c) => COLUMNAS[c][0]).join(", ")}.`);
    return { fechaCorte, bienes: [], totalGeneral: null, errores, advertencias };
  }
  if (idx.vidaMeses === undefined && idx.vidaAnios === undefined) {
    advertencias.push('No se encontró la vida útil ("Deprec. (meses)"); se guardará en 0.');
  }

  const celda = (f: unknown[], c: Col) => (idx[c] === undefined ? undefined : f[idx[c]!]);

  // 3) Recorrer los bienes
  const bienes: BienActivoFijo[] = [];
  let totalGeneral: ResultadoParseoActivos["totalGeneral"] = null;
  let oficinaActual: unknown = null;
  const oficinasDesconocidas = new Set<string>();
  const cuentasDesconocidas = new Set<string>();
  const codigosVistos = new Set<string>();
  let duplicados = 0, inactivos = 0, descuadres = 0, sinFecha = 0;

  for (let r = iTitulos + 1; r < filas.length; r++) {
    const f = filas[r] ?? [];
    const textoFila = f.map(norm).join(" | ");

    // Fila "Total General" del reporte: se usa para validar
    if (textoFila.includes("TOTAL GENERAL")) {
      const cont = numero(celda(f, "contable"));
      if (cont !== null) {
        totalGeneral = {
          contable: cont,
          depAcumulada: numero(celda(f, "depAcum")) ?? 0,
          depMensual: numero(celda(f, "depMes")) ?? 0,
          bienes: numero(celda(f, "residual")) ?? 0, // en este reporte la columna residual del total trae el conteo
        };
      }
      continue;
    }

    const ofi = celda(f, "oficina");
    if (norm(ofi) && !norm(ofi).startsWith("TOTAL")) oficinaActual = ofi;

    const codigo = String(celda(f, "codigo") ?? "").trim();
    // Solo filas de bienes: código con formato 18060505-0123 y un valor contable numérico
    if (!/^\d{4,}-\d+$/.test(codigo)) continue;
    const contable = numero(celda(f, "contable"));
    if (contable === null) continue;

    const estado = norm(celda(f, "estado"));
    if (idx.estado !== undefined && estado && estado !== "ACTIVO") { inactivos++; continue; }

    const agencia = normalizarOficinaActivos(oficinaActual);
    if (!agencia) { oficinasDesconocidas.add(String(oficinaActual ?? "(vacía)")); continue; }

    const cuenta = codigo.split("-")[0];
    const categoria = categoriaPorCuenta(cuenta);
    if (!categoria) { cuentasDesconocidas.add(cuenta); continue; }

    if (codigosVistos.has(codigo)) { duplicados++; continue; }
    codigosVistos.add(codigo);

    const fAct = fecha(celda(f, "fecAct")) ?? fecha(celda(f, "fecAdq"));
    if (!fAct) { sinFecha++; continue; }

    const depAcum = Math.abs(numero(celda(f, "depAcum")) ?? 0);
    const libros = numero(celda(f, "libros"));
    if (libros !== null && Math.abs(contable - depAcum - libros) > 0.05) descuadres++;

    const vidaMeses = numero(celda(f, "vidaMeses")) ?? Math.round((numero(celda(f, "vidaAnios")) ?? 0) * 12);

    bienes.push({
      agencia,
      codigo_activo: codigo,
      cuenta_codigo: cuenta,
      categoria,
      descripcion: String(celda(f, "descripcion") ?? "").trim(),
      fecha_adquisicion: fecha(celda(f, "fecAdq")),
      fecha_activacion: fAct,
      valor_contable: contable,
      valor_historico: numero(celda(f, "historico")) ?? contable,
      valor_residual: numero(celda(f, "residual")) ?? 0,
      vida_util_meses: Math.round(vidaMeses),
      dep_acumulada: depAcum,
      dep_mensual: Math.abs(numero(celda(f, "depMes")) ?? 0),
    });
  }

  if (oficinasDesconocidas.size) errores.push(`Oficinas que no coinciden con ninguna agencia: ${[...oficinasDesconocidas].join(", ")}.`);
  if (cuentasDesconocidas.size) advertencias.push(`Se omitieron bienes de cuentas sin categoría conocida: ${[...cuentasDesconocidas].join(", ")}.`);
  if (duplicados) errores.push(`${duplicados} códigos de activo aparecen repetidos en el reporte.`);
  if (inactivos) advertencias.push(`Se omitieron ${inactivos} bienes cuyo estado no es ACTIVO.`);
  if (sinFecha) advertencias.push(`Se omitieron ${sinFecha} bienes sin fecha de activación ni de adquisición.`);
  if (descuadres) advertencias.push(`${descuadres} bienes tienen Valor libros distinto de Valor contable − Depreciación acumulada.`);
  if (!bienes.length) errores.push("No se encontró ningún bien en el archivo.");

  // 4) Cuadre contra el Total General del reporte
  if (totalGeneral) {
    const sumC = bienes.reduce((s, b) => s + b.valor_contable, 0);
    const sumD = bienes.reduce((s, b) => s + b.dep_acumulada, 0);
    if (Math.abs(sumC - totalGeneral.contable) > 1 || Math.abs(sumD - totalGeneral.depAcumulada) > 1) {
      advertencias.push(
        `Los totales leídos no cuadran con el "Total General" del reporte (valor contable ${sumC.toFixed(2)} vs ${totalGeneral.contable.toFixed(2)}).`,
      );
    }
  } else if (bienes.length) {
    advertencias.push('No se encontró la fila "Total General" para comparar los totales.');
  }

  return { fechaCorte, bienes, totalGeneral, errores, advertencias };
}