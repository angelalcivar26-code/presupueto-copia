/**
 * Lectura del reporte contable «Amortización de activos diferidos» (gastos diferidos, 1905).
 *
 * El reporte trae, por oficina y por división (subcuenta), cada partida con su fecha de activación, el valor total a
 * amortizar y la vida útil en meses. La herramienta solo usa esas columnas (y el valor en libros para comprobar): las
 * demás que traiga el archivo completo se ignoran. Las columnas se reconocen por su título, no por su posición.
 *  - Oficina y división vienen solo en la primera fila de cada bloque: se arrastran hacia abajo.
 *  - Se saltan las filas «SUMA …», la fila «Total» y las partidas ya amortizadas (valor en libros 0).
 *  - Fin = activación + vida útil en meses. Con eso el motor reproduce las cuotas de contabilidad
 *    (valor ÷ vida útil, desde el mes siguiente a la activación).
 */
import { mesesAmortizacion } from "./activos-diferidos";

export interface FilaArchivo {
  agencia: string;        // nombre de la herramienta (Matriz, Piñas…)
  oficina: string;        // como viene en el archivo
  division: string;
  detalle: string;        // descripción completa
  descripcion: string;    // nombre corto
  fechaInicio: string;    // AAAA-MM-DD
  fechaFin: string;
  vidaUtil: number;       // meses
  monto: number;          // valor total a amortizar
  libros: number | null;  // valor en libros al corte según el archivo
  pendienteCalc: number;  // lo que calcula la herramienta al corte
  cuentaActivo: string;
  cuentaGasto: string;
  renueva: boolean;
}

export interface LecturaArchivo {
  filas: FilaArchivo[];
  omitidas: number;                       // ya amortizadas
  sinAgencia: string[];                   // oficinas que no se reconocen
  sinCuenta: string[];                    // divisiones sin cuenta
  faltan: string[];                       // columnas obligatorias que no se encontraron
  columnas?: string[];                    // títulos de las columnas que se usaron
  ignoradas?: number;                     // columnas con título que no se usan
}

const sinTilde = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normal = (s: unknown) => sinTilde(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Subcuenta del activo (1905) y del gasto (4506) de cada división del reporte. */
const CUENTAS_DIVISION: Record<string, [string, string]> = {
  "gastos de instalacion": ["19051005", "45061505"],
  "software de firewall": ["19052004", "45062505"],
  "programa de computacion": ["19052005", "45062505"],
  "programas de computacion": ["19052005", "45062505"],
  "licencias informaticas": ["19052009", "45062505"],
  "software de riesgo": ["19052011", "45062505"],
  "licencia antimalware": ["19052012", "45062505"],
  "katasoftware": ["19052016", "45062510"],
  "kata software": ["19052016", "45062510"],
  "licencia ibm": ["19052017", "45062505"],
  "gastos de adecuacion": ["19052505", "45063005"],
  "spred credmoney": ["19059025", "45069010"],
  "spred credmoney s a": ["19059025", "45069010"],
  "certificado digital ssl": ["19059045", "45069020"],
};
/** Cuenta de gasto por la subcuenta del activo (para divisiones nuevas que se encuentren en el catálogo). */
const GASTO_POR_ACTIVO: [string, string][] = [["190510", "45061505"], ["190515", "45062005"], ["190520", "45062505"], ["190525", "45063005"], ["190590", "45069020"]];

const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];
const agenciaDe = (oficina: string) => {
  const n = normal(oficina).replace(/^(agencia|ag|oficina)\s+/, "");
  return AGENCIAS.find((a) => normal(a) === n) ?? null;
};

const MINUS = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "e", "o", "u", "con", "para", "por", "a", "al", "mas", "más", "que", "su", "sus", "un", "una"]);
/** Descripción corta para la tabla: sin prefijos de trámite, en minúsculas si viene en mayúsculas, hasta ~48 caracteres. */
function nombreCorto(texto: string): string {
  let s = String(texto ?? "").replace(/\s+/g, " ").replace(/["“”]/g, "").trim();
  s = s.replace(/^(pago por concepto (por|de)|implementaci[oó]n y habilitaci[oó]n del servicio denominado|servicio de|por)\s+/i, "");
  const letras = s.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letras && letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / letras.length > 0.7) {
    s = s.split(" ").map((w) => {
      const l = w.toLowerCase();
      return w.replace(/[^A-Za-zÁÉÍÓÚÑ]/g, "").length <= 3 && !MINUS.has(l.replace(/[^a-záéíóúñ]/g, "")) ? w : l;
    }).join(" ");
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 48) {
    const cortes = [":", ";", ",", " (", " que ", " el cual", " según", " segun", " por el lapso", " para el ", " para la "];
    const i = Math.min(...cortes.map((c) => s.toLowerCase().indexOf(c)).filter((x) => x >= 15));
    if (Number.isFinite(i)) s = s.slice(0, i).trim();
  }
  if (s.length > 48) s = `${s.slice(0, s.lastIndexOf(" ", 46) > 20 ? s.lastIndexOf(" ", 46) : 46).replace(/[\s,.;:-]+$/, "")}…`;
  return s;
}

const isoDe = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // xlsx devuelve la fecha a medianoche local: se toma el día redondeando a la hora
    const d = new Date(v.getTime() + 12 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return NaN;
  return Number(s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
};
/** Misma fecha n meses después (último día del mes si no existe). */
function sumarMeses(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult))).toISOString().slice(0, 10);
}

/**
 * Filas de la hoja (arreglo de arreglos, como XLSX.utils.sheet_to_json con header: 1) → partidas de la 1905.
 * cuentas: catálogo (código y nombre) para reconocer divisiones nuevas por su nombre.
 */
export function leerArchivoDiferidos(hoja: unknown[][], fechaCorte: string, cuentas: { codigo: string; nombre: string }[] = []): LecturaArchivo {
  const res: LecturaArchivo = { filas: [], omitidas: 0, sinAgencia: [], sinCuenta: [], faltan: [] };
  // Fila de títulos: la primera que tiene «descripción» y una fecha. Si un título ocupa dos filas (celdas combinadas,
  // p. ej. «Valor» arriba y «en libros» abajo), se une con la fila de arriba.
  const esTit = (r: unknown[]) => r.some((x) => normal(x).startsWith("descripcion")) && r.some((x) => /^(fec|fecha)\b/.test(normal(x)));
  const iTit = hoja.findIndex((r) => Array.isArray(r) && esTit(r));
  if (iTit < 0) { res.faltan = ["DESCRIPCION", "FEC. ACTIVAC."]; return res; }
  const arriba = iTit > 0 && Array.isArray(hoja[iTit - 1]) ? hoja[iTit - 1] : [];
  const ancho = Math.max(hoja[iTit].length, arriba.length);
  const tit = Array.from({ length: ancho }, (_, i) => {
    const t = normal(hoja[iTit][i]), u = normal(arriba[i]);
    return t && u && !t.includes(u) && u.split(" ").length <= 3 ? `${u} ${t}` : t;
  });
  // Cada dato se busca con reglas de la más exacta a la más general; una columna ya usada no se vuelve a tomar.
  // Así el archivo puede traer más columnas (código, proveedor, factura, otras fechas o valores) sin confundir la lectura.
  const usadas = new Set<number>();
  const col = (...pruebas: ((t: string) => boolean)[]) => {
    for (const p of pruebas) { const i = tit.findIndex((t, j) => !!t && !usadas.has(j) && p(t)); if (i >= 0) { usadas.add(i); return i; } }
    return -1;
  };
  const tiene = (t: string, ...ps: string[]) => ps.every((x) => t.includes(x));
  const c = {
    descripcion: col((t) => t === "descripcion", (t) => t.startsWith("descripcion") && !tiene(t, "cuenta") && !tiene(t, "division")),
    oficina: col((t) => t === "oficina", (t) => t === "agencia", (t) => t.startsWith("oficina") || t.startsWith("agencia")),
    division: col((t) => t.startsWith("division"), (t) => tiene(t, "estructura"), (t) => t === "subcuenta" || t === "cuenta"),
    fecha: col((t) => tiene(t, "activ") && /^(fec|fecha)\b/.test(t), (t) => tiene(t, "activ"), (t) => t === "fecha" || t === "fec"),
    total: col((t) => tiene(t, "total", "amortizar"), (t) => tiene(t, "valor", "amortizar") && !tiene(t, "libros") && !tiene(t, "amort acum")),
    vida: col((t) => tiene(t, "vida", "mes"), (t) => tiene(t, "vida")),
    libros: col((t) => tiene(t, "libros")),
  };
  // vida útil en años (si el título lo dice) → meses
  const vidaEnAnios = c.vida >= 0 && /\banos?\b/.test(tit[c.vida]) && !tiene(tit[c.vida], "mes");
  const nombres: Record<string, string> = { oficina: "OFICINA", division: "DIVISION ESTRUCTURA", descripcion: "DESCRIPCION", fecha: "FEC. ACTIVAC.", total: "Valor total a Amortizar", vida: "Vida Util (meses)" };
  res.faltan = Object.entries(nombres).filter(([k]) => c[k as keyof typeof c] < 0).map(([, v]) => v);
  res.columnas = Object.values(c).filter((i) => i >= 0).map((i) => String(hoja[iTit][i] ?? arriba[i] ?? "").replace(/\s+/g, " ").trim());
  res.ignoradas = tit.filter((t, i) => t && !usadas.has(i)).length;
  if (res.faltan.length) return res;

  const corte = Date.parse(`${fechaCorte}T00:00:00Z`);
  const mCorte = new Date(corte).getUTCFullYear() * 12 + new Date(corte).getUTCMonth();
  const cat1905 = cuentas.filter((x) => x.codigo.startsWith("1905") && x.codigo.length >= 8);
  const cuentasDe = (div: string): [string, string] | null => {
    const n = normal(div);
    if (CUENTAS_DIVISION[n]) return CUENTAS_DIVISION[n];
    const a = cat1905.find((x) => normal(x.nombre) === n)?.codigo;
    if (!a) return null;
    return [a, GASTO_POR_ACTIVO.find(([p]) => a.startsWith(p))?.[1] ?? "45069020"];
  };
  let oficina = "", division = "";
  const sinA = new Set<string>(), sinC = new Set<string>();
  for (const r of hoja.slice(iTit + 1)) {
    if (!Array.isArray(r)) continue;
    const of = String(r[c.oficina] ?? "").trim(), dv = String(r[c.division] ?? "").trim();
    if (normal(of) === "total") break;           // total general
    if (normal(dv) === "total") continue;        // total de la oficina
    if (of) oficina = of;
    if (dv) division = dv;
    const det = String(r[c.descripcion] ?? "").replace(/\s+/g, " ").trim();
    if (!det || /^suma\b/i.test(det)) continue;
    const ini = isoDe(r[c.fecha]), monto = num(r[c.total]), vida = Math.round(num(r[c.vida]) * (vidaEnAnios ? 12 : 1));
    if (!ini || !(monto > 0) || !(vida > 0)) continue;
    const libros = c.libros >= 0 ? num(r[c.libros]) : NaN;
    const fin = sumarMeses(ini, vida);
    const am = mesesAmortizacion(Date.parse(`${ini}T00:00:00Z`), Date.parse(`${fin}T00:00:00Z`));
    const pend = am.hasta > mCorte ? (monto / am.n) * (am.hasta - Math.max(am.desde - 1, mCorte)) : 0;
    // ya amortizada: no se proyecta (si se renovó, la renovación viene en su propia fila)
    if ((Number.isFinite(libros) ? libros : pend) <= 0.005) { res.omitidas++; continue; }
    const agencia = agenciaDe(oficina);
    if (!agencia) { sinA.add(oficina); continue; }
    const ctas = cuentasDe(division);
    if (!ctas) { sinC.add(division); continue; }
    res.filas.push({
      agencia, oficina, division, detalle: det, descripcion: nombreCorto(det), fechaInicio: ini, fechaFin: fin, vidaUtil: vida, monto,
      libros: Number.isFinite(libros) ? libros : null, pendienteCalc: pend, cuentaActivo: ctas[0], cuentaGasto: ctas[1], renueva: false,
    });
  }
  // Renovación por defecto: licencias y suscripciones de un año o menos (programas de computación 190520 y certificados
  // 190590), salvo que ya haya otra de la misma agencia y división que empezó cerca de su vencimiento (esa ya es la
  // renovación). Instalaciones y adecuaciones no se renuevan.
  for (const f of res.filas) {
    if (f.vidaUtil > 12 || !(f.cuentaActivo.startsWith("190520") || f.cuentaActivo.startsWith("190590"))) continue;
    const finMs = Date.parse(`${f.fechaFin}T00:00:00Z`);
    const yaRenovada = res.filas.some((o) => o !== f && o.agencia === f.agencia && o.division === f.division && o.fechaInicio > f.fechaInicio
      && Math.abs(Date.parse(`${o.fechaInicio}T00:00:00Z`) - finMs) <= 92 * 86400000);
    f.renueva = !yaRenovada;
  }
  res.sinAgencia = [...sinA];
  res.sinCuenta = [...sinC];
  return res;
}

/** Nombre de las subcuentas de la 1905 (si el catálogo no las trae). */
export const NOMBRE_CUENTA_1905: Record<string, string> = {
  "19051005": "Gastos de instalación", "19052004": "Software de firewall", "19052005": "Programa de computación", "19052009": "Licencias informáticas",
  "19052011": "Software de riesgo", "19052012": "Licencia antimalware", "19052016": "KataSoftware", "19052017": "Licencia IBM",
  "19052505": "Gastos de adecuación", "19059025": "Spred credmoney", "19059045": "Certificado digital SSL",
};
