"use client";

/**
 * Piezas comunes de las pantallas del grupo de activos con tablas de 12 meses
 * (Otros activos y Cuentas por cobrar): paleta institucional, formatos, tarjetas,
 * tabla de meses con ƒ al final y tabla de parámetros editable.
 */
import { useState, type ReactNode } from "react";
import { Pencil, Check, ArrowRight, Hash } from "lucide-react";
import { useMostrarCodigos } from "../lib/mostrar-codigos";
import { leerMonto, textoEditable } from "../lib/numeros";

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];

// Paleta institucional (misma de Cartera e Inversiones)
export const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#7A847F",
  borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F3F5F4",
  cabecera: "#FFFFFF", cabeceraTexto: "#3D4843",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", aviso: "#B7791F", avisoSuave: "#FBF1DC", alerta: "#B42318",
};
export const FONDO = "#EEF1EF";
export const BORDE_EDICION = "#8DB39B";
export const CHIP_ON = { background: C.acentoSuave, color: C.acento };
export const CHIP_OFF = { background: "transparent", color: C.texto2 };

export const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);
// Negativos entre paréntesis (convención contable)
export function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
export function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
export function pct(frac: number, d = 2): string {
  return (frac * 100).toFixed(d).replace(".", ",") + " %";
}
export const etiquetaCorte = (c: { anio: number; mes: number }) => `${MESES[c.mes - 1].toLowerCase()}-${String(c.anio).slice(2)}`;
export const cifra = (v: number) => (Math.round(v) === 0 ? "—" : numero(v));
/**
 * Lee un monto en formato Ecuador (punto = miles, coma = decimales) con el lector común de la
 * herramienta (lib/numeros.ts). Devuelve null si está vacío o no se puede leer (p. ej. "2.5").
 */
export function leerNumero(texto: string): number | null {
  const r = leerMonto(texto);
  return r.error ? null : r.valor;
}

export type Fuente = "guardado" | "referencia" | "sin datos";
/** Un parámetro editable mes a mes (se guarda con /api/otros-pasivo-parametros). */
export interface DefParametro { concepto: string; label: string; esPct?: boolean }

export const TABLA = "w-full table-fixed text-[11px] border-collapse";
/** Ancho extra de la primera columna cuando se ven los códigos contables. */
export const ANCHO_CODIGO = 70;
export function Columnas({ conCodigos }: { conCodigos?: boolean } = {}) {
  return (
    <colgroup>
      <col style={{ width: 243 + (conCodigos ? ANCHO_CODIGO : 0) }} />
      {MESES.map((m) => <col key={m} />)}
      <col style={{ width: 90 }} />
      <col style={{ width: 25 }} />
    </colgroup>
  );
}
export function Cabecera({ titulo, ultima, accion }: { titulo: ReactNode; ultima: string; accion?: ReactNode }) {
  return (
    <thead>
      <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
        <th className="pl-4 pr-2 text-left font-semibold">
          {accion ? <span className="flex items-center gap-2"><span className="flex-1 min-w-0 truncate">{titulo}</span>{accion}</span> : titulo}
        </th>
        {MESES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
        <th className="px-2 text-right font-semibold">{ultima}</th>
        <th aria-hidden="true" />
      </tr>
    </thead>
  );
}

export function BotonesSeccion({ editando, cambios, guardando, onEditar, onCancelar, onGuardar }: {
  editando: boolean; cambios: number; guardando: boolean; onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
}) {
  if (!editando) {
    return (
      <button type="button" onClick={onEditar} className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F3F5F4]"
              style={{ border: "1px solid #C9D0CC", color: C.texto }}>
        <Pencil size={14} /> Editar
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancelar} disabled={guardando} className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold disabled:opacity-50"
              style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
      <button type="button" onClick={onGuardar} disabled={guardando || cambios === 0}
              className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.acento }}>
        <Check size={14} /> {guardando ? "Guardando..." : cambios ? `Guardar ${cambios} ${cambios === 1 ? "cambio" : "cambios"}` : "Guardar"}
      </button>
    </div>
  );
}

export function BotonF({ abierto, onClick, titulo }: { abierto: boolean; onClick: () => void; titulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={abierto} title={titulo} aria-label={titulo}
            className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
            style={abierto ? CHIP_ON : { color: C.tenue }}>ƒ</button>
  );
}

export function ChipsMes({ valor, onChange }: { valor: number; onChange: (i: number) => void }) {
  return (
    <div role="group" aria-label="Mes de la fórmula" className="flex flex-wrap gap-0.5">
      {MESES.map((m, i) => (
        <button key={m} type="button" onClick={() => onChange(i)} aria-pressed={valor === i}
                className="w-[32px] h-[25px] rounded text-[11px] font-semibold" style={valor === i ? CHIP_ON : CHIP_OFF}>{m}</button>
      ))}
    </div>
  );
}

export function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: ReactNode; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}
export function FranjaIndicadores({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{children}</div>;
}

/** Tarjeta con barra de título (como Proyección mensual en Cartera); la tabla va de borde a borde. */
export function Tarjeta({ titulo, sub, derecha, children, editando }: { titulo: ReactNode; sub?: ReactNode; derecha?: ReactNode; children: ReactNode; editando?: boolean }) {
  return (
    <section className="tarjeta overflow-hidden flex flex-col"
             style={editando ? { borderColor: BORDE_EDICION, boxShadow: `0 0 0 2px ${C.acentoSuave}` } : undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="text-[14px] font-semibold">{titulo}</h2>
        {sub && <span className="text-[12px]" style={{ color: C.texto2 }}>{sub}</span>}
        <span className="flex-1" />
        {derecha}
      </div>
      {children}
    </section>
  );
}

/** Filas de una tabla de 12 meses con ƒ en la etiqueta y panel de fórmula abajo. */
export interface DefFila {
  id: string; label: string; valores: number[]; total: number | null; clave?: boolean; tenue?: boolean;
  color?: "ok" | "alerta";  // entradas en verde, salidas en rojo
  signo?: boolean;          // cada celda en verde si es positiva y en rojo si es negativa
  totalConSigno?: boolean;  // la última columna en verde si sube y en rojo si baja
  esPct?: boolean;          // la fila se muestra en %
  separador?: boolean; formula?: (i: number) => string; onClick?: () => void;
  fuerte?: boolean;         // en negrita sin línea de total (p. ej. el subtotal de un grupo)
  /** El total del año sin negrita (filas de detalle). */
  totalNormal?: boolean;
  sangria?: boolean;        // con sangría (detalle de un grupo)
  /** Código contable de la fila (se muestra antes del nombre). Varias cuentas: "21013505 + 21013510". */
  codigo?: string;
}
export function TablaMeses({ titulo, ultima, filas, grupos, titulosAparte }: {
  titulo: ReactNode; ultima: string; filas: DefFila[]; grupos?: Record<string, string>;
  /** true: el título de cada grupo va en su propia fila (solo el nombre) y las filas del grupo quedan con sangría. */
  titulosAparte?: boolean;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(0);
  // botón # solo si alguna fila trae código (las tablas de movimientos quedan como estaban); los códigos se ven a pedido
  const hayCodigos = filas.some((f) => f.codigo);
  const [verCodigos, cambiarCodigos] = useMostrarCodigos();
  const conCodigo = hayCodigos && verCodigos;
  const texto = (f: DefFila, v: number) => (f.esPct ? (v === 0 ? "—" : pct(v)) : cifra(v));
  const fuerte = (f: DefFila) => (!titulosAparte && !!grupos?.[f.id]) || !!f.clave || !!f.fuerte;
  const colorCelda = (f: DefFila, v: number) => {
    if (!f.esPct && Math.round(v) === 0) return C.tenue;
    if (f.signo) return v > 0 ? C.ok : C.alerta;
    if (f.color) return C[f.color];
    return fuerte(f) ? C.texto : f.tenue ? C.texto2 : C.texto3;
  };
  return (
    <div>
      <table className={TABLA}>
        <Columnas conCodigos={conCodigo} />
        <Cabecera titulo={titulo} ultima={ultima} accion={hayCodigos ? <BotonCodigos ver={verCodigos} onCambiar={cambiarCodigos} /> : undefined} />
        <tbody>
          {filas.map((f, k) => {
            const titGrupo = grupos?.[f.id];
            const grupo = titulosAparte ? undefined : titGrupo;
            const sangria = (titulosAparte && !f.clave) || !!f.sangria;
            // El título del grupo va en la misma fila (sin filas vacías) y con un espacio blanco antes del grupo siguiente.
            const borde = titulosAparte && titGrupo ? `1px solid ${C.beige}` : grupo ? (k === 0 ? "none" : "1px solid #DDE2DF") : f.clave ? "1px solid #B9C3BD" : f.separador ? "1px solid #DDE2DF" : `1px solid ${C.beige}`;
            return (
              <FilaGrupo key={f.id} espacio={(!!titGrupo || !!f.separador) && k > 0}>
                {titulosAparte && titGrupo && (
                  <tr style={{ borderTop: k === 0 ? "none" : "1px solid #DDE2DF", height: 31 }}>
                    <td colSpan={15} className="pl-4 text-[12px] font-bold" style={{ color: C.acento }}>{titGrupo}</td>
                  </tr>
                )}
                <tr onClick={f.onClick} className={f.onClick ? "cursor-pointer hover:bg-[#F5F7F6]" : "hover:bg-[#F5F7F6]"}
                    style={{ borderTop: borde, height: 32, fontWeight: fuerte(f) ? 600 : 400 }}>
                  <td className="pl-4">
                    <span className="flex items-center gap-1.5 pr-2 min-w-0">
                      {/* el código va siempre en la misma posición (antes de la sangría) para que detalle y total queden alineados */}
                      {conCodigo && <span className="shrink-0 py-1" style={{ width: ANCHO_CODIGO - 6 }}><CodigosFila codigo={f.codigo} /></span>}
                      {sangria && <span className="shrink-0" style={{ width: 12 }} aria-hidden="true" />}
                      {grupo ? (
                        <span className="flex-1 min-w-0 flex items-baseline gap-1.5 whitespace-nowrap overflow-hidden" title={`${grupo} · ${f.label}`}>
                          <span className="text-[12px] font-bold shrink-0" style={{ color: C.acento }}>{grupo}</span>
                          <span className="text-[11px] font-normal truncate" style={{ color: C.texto2 }}>· {f.label.toLowerCase()}</span>
                        </span>
                      ) : (
                        <>
                          <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]" title={f.label}
                                style={{ color: fuerte(f) ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>{f.label}</span>
                        </>
                      )}
                    </span>
                  </td>
                  {f.valores.map((v, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: colorCelda(f, v) }}>{texto(f, v)}</td>
                  ))}
                  <td className={`px-2 text-right whitespace-nowrap ${f.totalNormal && !fuerte(f) ? "" : "font-semibold"}`}
                      style={{ color: f.total === null || (!f.esPct && Math.round(f.total) === 0) ? C.tenue : f.totalConSigno || f.signo ? (f.total > 0 ? C.ok : C.alerta) : f.color ? C[f.color] : C.texto }}>
                    {f.total === null ? "" : texto(f, f.total)}
                  </td>
                  {/* ƒ al final de la fila, como en Cartera */}
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    {f.formula && <BotonF abierto={abierta === f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} titulo={`Fórmula de ${f.label}`} />}
                  </td>
                </tr>
                {/* la fórmula se abre debajo de su fila */}
                {abierta === f.id && f.formula && (
                  <tr>
                    <td colSpan={15} className="p-0">
                      <div className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.beige}`, borderBottom: `1px solid ${C.beige}`, background: C.crema }}>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono text-[12px]">ƒ</span>
                          <b className="text-[12px] flex-1">{f.label}</b>
                          <ChipsMes valor={mes} onChange={setMes} />
                        </div>
                        <p className="text-[12px] font-normal" style={{ color: C.texto3 }}><span className="font-semibold" style={{ color: C.acento }}>{MESES[mes]} · </span>{f.formula(mes)}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </FilaGrupo>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function FilaGrupo({ espacio, children }: { espacio: boolean; children: ReactNode }) {
  return (
    <>
      {espacio && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={15} /></tr>}
      {children}
    </>
  );
}

export const ETIQUETA_FUENTE: Record<Fuente, { texto: string; color: string; fondo: string }> = {
  guardado: { texto: "Guardado", color: C.ok, fondo: "#E3F1E7" },
  referencia: { texto: "Referencia Excel", color: "#6E4A0E", fondo: C.avisoSuave },
  "sin datos": { texto: "Sin movimiento", color: C.texto2, fondo: C.crema },
};

export function Parametros<P extends DefParametro>({ titulo, params, valores, fuente, editando, cambios, guardando, textos, msg, onEditar, onCancelar, onGuardar, onEscribir, onSoltar, onCopiarEnero }: {
  titulo: string; params: P[]; valores: (c: P["concepto"]) => number[]; fuente: (c: P["concepto"]) => Fuente | null;
  editando: boolean; cambios: number; guardando: boolean; textos: Record<string, string>; msg: { t: string; e?: boolean } | null;
  onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
  onEscribir: (p: P, mes: number, texto: string) => void; onSoltar: (k: string) => void; onCopiarEnero: (p: P) => void;
}) {
  const campoEstilo = editando ? { border: `1px solid ${BORDE_EDICION}`, background: "#FFFFFF" } : { border: "1px solid transparent", background: "transparent" };
  const mostrar = (p: DefParametro, v: number) => (p.esPct ? (v * 100).toFixed(2).replace(".", ",") : editando ? textoEditable(v) || "0" : cifra(v));
  // Antes de guardar se revisa que todo lo escrito se pueda leer; si no, se dice en qué casilla
  const [errLocal, setErrLocal] = useState<string | null>(null);
  function guardarSeguro() {
    for (const [k, t] of Object.entries(textos)) {
      const e = leerMonto(t).error;
      if (!e) continue;
      const [concepto, mes] = [k.slice(0, k.lastIndexOf("-")), Number(k.slice(k.lastIndexOf("-") + 1))];
      const p = params.find((x) => x.concepto === concepto);
      setErrLocal(`${p?.label ?? concepto}, ${MESES[mes] ?? ""}: ${e}.`);
      return;
    }
    setErrLocal(null);
    onGuardar();
  }
  const hayPct = params.some((p) => p.esPct);
  return (
    <Tarjeta titulo={titulo} editando={editando}
      derecha={<BotonesSeccion editando={editando} cambios={cambios} guardando={guardando} onEditar={() => { setErrLocal(null); onEditar(); }} onCancelar={() => { setErrLocal(null); onCancelar(); }} onGuardar={guardarSeguro} />}>
      {editando && (
        <div className="flex items-center gap-2 mx-4 mt-3 px-3.5 py-2 rounded-md text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
          <Pencil size={14} /> Escribe el valor de cada mes ({hayPct ? "en %, ej. 5,90" : "en dólares"}) · → copia enero a los 12 meses · luego Guardar.
        </div>
      )}
      <div className={editando ? "mt-2" : undefined}>
        <table className={TABLA}>
          <Columnas />
          <Cabecera titulo="Parámetro" ultima={hayPct ? "Promedio" : "Total año"} />
          <tbody>
            {params.map((p) => {
              const vals = valores(p.concepto);
              const f = fuente(p.concepto);
              return (
                <tr key={p.concepto} style={{ borderTop: `1px solid ${C.beige}`, height: editando ? 36 : 30 }}>
                  <td className="pl-4">
                    <span className="flex items-center gap-2 pr-2">
                      <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]" title={p.label} style={{ color: C.texto3 }}>{p.label}</span>
                      {f && !editando && (
                        <span className="text-[10px] font-semibold px-1.5 py-px rounded whitespace-nowrap"
                              style={{ background: ETIQUETA_FUENTE[f].fondo, color: ETIQUETA_FUENTE[f].color }}>{ETIQUETA_FUENTE[f].texto}</span>
                      )}
                      {editando && (
                        <button type="button" onClick={() => onCopiarEnero(p)} title="Copiar enero a los 12 meses" aria-label={`Copiar enero de ${p.label} a los 12 meses`}
                                className="w-7 h-7 rounded inline-flex items-center justify-center shrink-0" style={{ border: "1px solid #C9D0CC", color: C.texto }}><ArrowRight size={14} /></button>
                      )}
                    </span>
                  </td>
                  {vals.map((v, i) => {
                    const k = `${p.concepto}-${i}`;
                    return (
                      <td key={i} className="px-1 text-right">
                        {editando ? (
                          <input value={textos[k] ?? mostrar(p, v)} inputMode="decimal" aria-label={`${p.label} en ${MESES[i]}`}
                                 aria-invalid={!!(textos[k] && leerMonto(textos[k]).error)} title={textos[k] ? leerMonto(textos[k]).error ?? undefined : undefined}
                                 onChange={(e) => onEscribir(p, i, e.target.value)}
                                 onBlur={() => { if (!leerMonto(textos[k] ?? "").error) onSoltar(k); }}
                                 className="w-full max-w-[70px] h-7 rounded px-1.5 text-right text-[11px]"
                                 style={textos[k] && leerMonto(textos[k]).error ? { ...campoEstilo, border: "1px solid #B42318", background: "#FDF2F1" } : campoEstilo} />
                        ) : (
                          <span style={{ color: Math.round(v * (p.esPct ? 10000 : 1)) === 0 ? C.tenue : C.texto }}>{mostrar(p, v)}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 text-right font-semibold whitespace-nowrap" style={{ color: C.texto }}>
                    {p.esPct ? pct(suma(vals) / 12) : cifra(suma(vals))}
                  </td>
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errLocal && <p role="alert" className="px-4 py-3 text-[12px]" style={{ color: C.alerta, borderTop: `1px solid ${C.beige}` }}>{errLocal}</p>}
      {msg && <p className="px-4 py-3 text-[12px]" style={{ color: msg.e ? C.alerta : C.ok, borderTop: `1px solid ${C.beige}` }}>{msg.t}</p>}
    </Tarjeta>
  );
}
/** Botón # de la cabecera: muestra u oculta los códigos contables de la tabla (preferencia de quien mira). */
export function BotonCodigos({ ver, onCambiar }: { ver: boolean; onCambiar: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onCambiar(); }} aria-pressed={ver}
            title={ver ? "Ocultar los códigos contables" : "Ver los códigos contables"}
            className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[#E3EEE7]"
            style={ver ? CHIP_ON : { color: C.tenue }}>
      <Hash size={12} />
    </button>
  );
}

/** Códigos de una fila: uno por línea (una fila que suma varias cuentas muestra todas). */
export function CodigosFila({ codigo }: { codigo?: string }) {
  if (!codigo) return null;
  const lista = codigo.split("+").map((c) => c.trim()).filter(Boolean);
  return (
    <span className="flex flex-col leading-[1.15] text-[10.5px] tabular-nums" style={{ color: C.tenue }}>
      {lista.map((c) => <span key={c}>{c}</span>)}
    </span>
  );
}
