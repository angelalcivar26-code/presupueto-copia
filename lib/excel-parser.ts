/**
 * Parser de Excel de saldos — detección de columnas por puntaje ponderado.
 *
 * Replica el algoritmo real ya probado en el dashboard de indicadores
 * (no un conteo simple de votos, que confunde un código como "1.1.01.05.15"
 * con un saldo decimal como "58975152.3" porque ambos "parecen" dígitos con
 * punto). Reglas clave:
 * - 2+ puntos en la celda -> fuerte señal de código (ej. "1.1.01.05.15")
 * - 1 punto con 2 decimales y valor > 10 -> señal de saldo (ej. "58975152.3"),
 *   NO de código de 2 niveles (ej. "1.1")
 * - sin puntos, 3-10 dígitos -> código (ej. "110205")
 * - texto con letras -> nombre
 * - número no entero o > 9999, o texto con coma/signo -> saldo
 *
 * El código final se limpia quitando los puntos ("1.1.01.05.15" -> "11010515"),
 * igual formato que ya usan los motores (lib/calc) y el resto del sistema.
 */

/** Detecta si el archivo trae encabezados de Situación Financiera, Resultados u Orden. */
function detectarTipoEncabezado(filasCrudas: unknown[][]): "situacion_financiera" | "resultados" | "orden" | null {
  for (const fila of filasCrudas.slice(0, 25)) {
    if (!Array.isArray(fila)) continue;
    for (const celda of fila) {
      const v = String(celda ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (v.includes("situacion financiera") || v.includes("balance general") || v.includes("estado de situacion")) {
        return "situacion_financiera";
      }
      if (v.includes("perdidas y ganancias") || v.includes("estado de resultados") || v.includes("estado de perdidas")) {
        return "resultados";
      }
      if (v.includes("cuentas de orden") || v.includes("cuenta de orden")) {
        return "orden";
      }
    }
  }
  return null;
}

export interface FilaParseada {
  codigo: string;
  nombre: string;
  saldo: number;
}

interface ResultadoParseoExcel {
  filas: FilaParseada[];
  maxVotesCod: number;
  maxVotesNom: number;
  maxVotesSald: number;
  oficinaDetectada: string | null;
  fechaDetectada: { anio: number; mes: number } | null;
  tipoDetectado: "situacion_financiera" | "resultados" | "orden" | null;
}

function detectarOficina(filasCrudas: unknown[][]): string | null {
  for (const fila of filasCrudas.slice(0, 10)) {
    if (!Array.isArray(fila)) continue;
    for (let c = 0; c < fila.length; c++) {
      const valor = String(fila[c] ?? "").trim().toLowerCase();
      if (valor === "oficina:" || valor === "oficina") {
        for (let k = c + 1; k < fila.length; k++) {
          const siguiente = String(fila[k] ?? "").trim();
          if (siguiente) return siguiente;
        }
      }
    }
  }
  return null;
}

function detectarFecha(filasCrudas: unknown[][]): { anio: number; mes: number } | null {
  for (const fila of filasCrudas.slice(0, 10)) {
    if (!Array.isArray(fila)) continue;
    for (let c = 0; c < fila.length; c++) {
      const valor = String(fila[c] ?? "").trim().toLowerCase();
      if (valor === "fecha:" || valor === "fecha") {
        for (let k = c + 1; k < fila.length; k++) {
          const siguiente = String(fila[k] ?? "").trim();
          if (!siguiente) continue;
          const match = siguiente.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
          if (match) return { mes: Number(match[2]), anio: Number(match[3]) };
          return null;
        }
      }
    }
  }
  return null;
}

/** Parseo de saldo tolerante a "$", comas de miles, coma decimal, y paréntesis como negativo. */
function parsearSaldoCelda(rawVal: unknown): number {
  if (typeof rawVal === "number") return rawVal;
  let s = String(rawVal ?? "0").trim();
  const esNegativoParentesis = s.startsWith("(") && s.endsWith(")");
  if (esNegativoParentesis) s = s.slice(1, -1);
  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const limpio = s.replace(/[^0-9.-]/g, "");
  let n = parseFloat(limpio) || 0;
  if (esNegativoParentesis) n = -n;
  return n;
}

const MAX_COLS = 100;

export function parsearSaldosExcel(filasCrudas: unknown[][]): ResultadoParseoExcel {
  const colVotesCod = new Array(MAX_COLS).fill(0);
  const colVotesNom = new Array(MAX_COLS).fill(0);
  const colVotesSald = new Array(MAX_COLS).fill(0);

  const finScan = Math.min(filasCrudas.length, 300);
  for (let r = 0; r < finScan; r++) {
    const fila = filasCrudas[r];
    if (!Array.isArray(fila)) continue;

    for (let c = 0; c < Math.min(fila.length, MAX_COLS); c++) {
      const val = fila[c];
      if (val === undefined || val === null) continue;
      const str = String(val).trim();
      if (!str) continue;

      // --- Código ---
      const soloDigitosYPuntos = /^[0-9.]+$/.test(str);
      if (soloDigitosYPuntos) {
        const puntos = (str.match(/\./g) || []).length;
        if (puntos >= 2) {
          colVotesCod[c] += 15;
        } else if (puntos === 1) {
          const partes = str.split(".");
          if (partes[1].length === 2 && parseFloat(str) > 10.0) {
            colVotesSald[c] += 8; // ej. 58975152.3 -> saldo, no código "1.1"
          } else {
            colVotesCod[c] += 10;
          }
        } else if (/^[0-9]{3,10}$/.test(str)) {
          colVotesCod[c] += 5;
        } else if (/^[1-9]$/.test(str)) {
          colVotesCod[c] += 2;
        }
      }

      // --- Nombre ---
      const tieneLetras = /[a-zA-ZÁÉÍÓÚáéíóúñÑ]/.test(str);
      if (tieneLetras && str.length > 3) {
        colVotesNom[c] += 10;
      }

      // --- Saldo ---
      if (typeof val === "number") {
        if (!Number.isInteger(val) || Math.abs(val) > 9999) {
          colVotesSald[c] += 15;
        } else if (val !== 0) {
          colVotesSald[c] += 5;
        }
      } else {
        const tieneComa = str.includes(",");
        const tieneMoneda = str.includes("$");
        const tieneNegativo = str.startsWith("-") || str.includes("(");
        const limpio = str.replace(/[^0-9.-]/g, "");
        const parseado = parseFloat(limpio);
        if (!isNaN(parseado) && str !== "") {
          if (tieneComa || tieneMoneda || tieneNegativo) {
            colVotesSald[c] += 15;
          } else if (str.includes(".")) {
            const partes = str.split(".");
            colVotesSald[c] += partes[partes.length - 1].length === 2 ? 10 : 2;
          } else {
            colVotesSald[c] += 2;
          }
        }
      }
    }
  }

  let colCod = -1, colNom = -1, colSald = -1;
  let maxVotesCod = 0, maxVotesNom = 0, maxVotesSald = 0;

  for (let c = 0; c < MAX_COLS; c++) {
    if (colVotesCod[c] > maxVotesCod) { maxVotesCod = colVotesCod[c]; colCod = c; }
  }
  for (let c = 0; c < MAX_COLS; c++) {
    if (c === colCod) continue;
    if (colVotesNom[c] > maxVotesNom) { maxVotesNom = colVotesNom[c]; colNom = c; }
  }
  for (let c = 0; c < MAX_COLS; c++) {
    if (c === colCod || c === colNom) continue;
    if (colVotesSald[c] > maxVotesSald) { maxVotesSald = colVotesSald[c]; colSald = c; }
  }

  if (colCod === -1) colCod = 0;
  if (colNom === -1) colNom = colCod === 1 ? 0 : 1;
  if (colSald === -1) {
    for (let c = 0; c < MAX_COLS; c++) {
      if (c !== colCod && c !== colNom) { colSald = c; break; }
    }
  }

  const filas: FilaParseada[] = [];
  for (const fila of filasCrudas) {
    if (!Array.isArray(fila)) continue;
    const rawCodigo = String(fila[colCod] ?? "").trim();
    const rawNombre = String(fila[colNom] ?? "").trim();
    if (!rawCodigo && !rawNombre) continue;

    const codigo = rawCodigo.replace(/[^0-9]/g, "").trim(); // quita puntos: "1.1.01.05.15" -> "11010515"
    if (!/^[0-9]+$/.test(codigo) || codigo.length === 0) continue;

    filas.push({ codigo, nombre: rawNombre || `Cuenta ${codigo}`, saldo: parsearSaldoCelda(fila[colSald]) });
  }

  return {
    filas,
    maxVotesCod,
    maxVotesNom,
    maxVotesSald,
    oficinaDetectada: detectarOficina(filasCrudas),
    fechaDetectada: detectarFecha(filasCrudas),
    tipoDetectado: detectarTipoEncabezado(filasCrudas),
  };
}