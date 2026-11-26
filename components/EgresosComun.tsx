"use client";

import { exportarPantalla } from "../lib/exportar-excel";
import AnioEjercicio from "./AnioEjercicio";
import { cargarJSON, precargar, tieneDatos } from "../lib/useDatos";
import { Children, Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { EsqueletoTabla } from "./Carga";
import { useGuardiaCambios } from "./GuardiaCambios";

/**
 * Piezas comunes de las 4 secciones de Egresos (41 Intereses, 44 Provisiones, 45 Gastos operacionales, Otros gastos).
 * Estilo institucional: verde #005A28, dorado #C38A03 solo como detalle, tablas blancas sin franjas,
 * Tahoma en tablas y Segoe UI en textos, negativos entre paréntesis y ƒ en la última columna.
 */

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export const AGENCIAS = [
  "Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez",
  "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo",
];

export const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#8A938E", cero: "#C4CAC6",
  borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F3F5F4",
  acento: "#005A28", acentoSuave: "#E3EEE7", dorado: "#C38A03",
  ok: "#1E6B3A", aviso: "#B7791F", avisoSuave: "#FBF1DC", alerta: "#B42318", alertaSuave: "#FBE4E1",
};
const BORDE_EDICION = "#8DB39B";
/** Fondo institucional (mismo de Balance, Cartera, Activos...). */
const FONDO = "#EEF1EF";
/** Contenedor de página: misma clase y fondo que las demás secciones. */
export const PAGINA = "estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5";
export const PAGINA_STYLE = { background: FONDO, color: "#111418", fontVariantNumeric: "tabular-nums" } as const;
export const F_TABLA = { fontFamily: "Tahoma, Verdana, Geneva, sans-serif" } as const;
export const F_TEXTO = { fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif' } as const;

export const suma = (a: number[]) => a.reduce((s, x) => s + (Number(x) || 0), 0);

// ---------------------------------------------------------------------
// Mensual / Acumulado (ingresos y gastos): una sola elección para todas estas pantallas, recordada en el navegador.
// Los cálculos y la edición son siempre mensuales; «Acumulado» solo cambia lo que se muestra en los meses
// (enero a ese mes), igual que el Estado de resultados. La columna «Año» es la misma en las dos vistas.
// ---------------------------------------------------------------------
export type BaseMes = "mensual" | "acumulado";
const CLAVE_BASE = "vista-meses-ingresos-gastos";
let baseMes: BaseMes = "mensual";
const oyentesBase = new Set<() => void>();
if (typeof window !== "undefined") {
  try { const v = window.localStorage.getItem(CLAVE_BASE); if (v === "acumulado" || v === "mensual") baseMes = v; } catch { /* sin almacenamiento */ }
}
export function setBaseMes(b: BaseMes) {
  baseMes = b;
  try { window.localStorage.setItem(CLAVE_BASE, b); } catch { /* sin almacenamiento */ }
  oyentesBase.forEach((f) => f());
}
export function useBaseMes(): BaseMes {
  return useSyncExternalStore((f) => { oyentesBase.add(f); return () => { oyentesBase.delete(f); }; }, () => baseMes, () => "mensual");
}
export const acumular = (v: number[]) => { let t = 0; return v.map((x) => (t += Number(x) || 0)); };
/** Valores de los 12 meses como se deben mostrar (mensual o acumulado). */
export function useVerMes() {
  const b = useBaseMes();
  return useCallback((v: number[]) => (b === "acumulado" ? acumular(v) : v), [b]);
}
/** Al editar montos mensuales la vista vuelve a Mensual (no se editan acumulados). */
export function useMensualAlEditar(editando: boolean) {
  useEffect(() => { if (editando && baseMes === "acumulado") setBaseMes("mensual"); }, [editando]);
}
export function SelectorBaseMes() {
  const b = useBaseMes();
  return (
    <div role="group" aria-label="Ver los meses" className="inline-flex p-[3px] gap-0.5 rounded-lg bg-white" style={{ border: "1px solid #D5DBD7", fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif' }}>
      {([["mensual", "Mensual"], ["acumulado", "Acumulado"]] as const).map(([id, label]) => {
        const on = b === id;
        return (
          <button key={id} type="button" aria-pressed={on} onClick={() => setBaseMes(id)} title={id === "mensual" ? "Lo de cada mes" : "De enero a cada mes, como el Estado de resultados"}
                  className="h-7 px-3 rounded text-[12px]" style={on ? { background: "#E3EEE7", color: "#005A28", fontWeight: 600 } : { color: "#5B6570" }}>{label}</button>
        );
      })}
    </div>
  );
}

/** Cifra de tabla: sin símbolo, negativos entre paréntesis. */
export function cifra(n: number): string {
  const t = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 && Math.round(n) !== 0 ? `(${t})` : t;
}
/** Cifra con $: tarjetas y fórmulas. */
export function usd(n: number): string {
  const t = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 && Math.round(n) !== 0 ? `($${t})` : `$${t}`;
}
/** Porcentaje con coma decimal; negativos entre paréntesis. */
export function pct(n: number, dec = 2): string {
  const t = `${Math.abs(n * 100).toLocaleString("es-EC", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
  return n < 0 && Number((n * 100).toFixed(dec)) !== 0 ? `(${t})` : t;
}
export const etiquetaMes = (m: string, ejercicio: number) => `${m} ${String(ejercicio).slice(2)}`;

// ---------------------------------------------------------------------
// Estado de resultados (fuente de 41, 44, 4505 y de las tarjetas)
// ---------------------------------------------------------------------

export interface Nodo { codigo: string; label: string; valores: number[]; hijos?: Nodo[] }

export function buscarNodo(n: Nodo | null | undefined, codigo: string): Nodo | null {
  if (!n) return null;
  if (n.codigo === codigo) return n;
  for (const h of n.hijos ?? []) {
    const r = buscarNodo(h, codigo);
    if (r) return r;
  }
  return null;
}

/** El Estado de resultados trae saldos ACUMULADOS (dic = total del año); aquí se pasan a movimiento del mes. */
function desacumular(n: Nodo): Nodo {
  const v = n.valores ?? [];
  return {
    ...n,
    valores: v.map((x, i) => (i === 0 ? x : x - (v[i - 1] ?? 0))),
    hijos: n.hijos?.map(desacumular),
  };
}

/** Egresos (grupo 4) del Estado de resultados de la agencia, en movimiento mensual. `version` recarga tras guardar. */
export function useEgresos(agencia: string, ejercicio: number, version = 0) {
  const { egresos, calculadas, cargando } = useResultados(agencia, ejercicio, version);
  return { egresos, calculadas, cargando };
}

/**
 * Lectura con memoria (misma de las demás pantallas, lib/useDatos → cargarJSON): si ya se leyó antes,
 * se muestra al instante y se actualiza por detrás. Cualquier guardado borra la memoria, así que nunca
 * se ven cifras viejas después de guardar. `version` obliga a volver a leer. url = null → no lee.
 */
export function useJSON<T>(url: string | null, version = 0) {
  // Los datos van junto con su dirección: al cambiar de agencia no se muestran los de la anterior
  const [estado, setEstado] = useState<{ url: string | null; datos: T | null }>({ url: null, datos: null });
  const [cargando, setCargando] = useState(!!url);
  useEffect(() => {
    if (!url) { setEstado({ url: null, datos: null }); setCargando(false); return; }
    let vivo = true;
    setCargando(!tieneDatos(url));
    cargarJSON<T>(url, (d) => { if (vivo) { setEstado({ url, datos: d }); setCargando(false); } })
      .catch(() => { if (vivo) setEstado({ url, datos: null }); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [url, version]);
  const datos = estado.url === url ? estado.datos : null;
  return { datos, cargando: cargando || (!!url && estado.url !== url) };
}

export const urlResultados = (agencia: string, ejercicio: number) => `/api/estado-resultados?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;

/**
 * Pide por adelantado (sin mostrar nada) lo que usan las 4 secciones de Egresos para esa agencia:
 * así, al pasar de Intereses a Provisiones o a Gastos operacionales, los datos ya están.
 */
export function usePrecargaEgresos(agencia: string, ejercicio: number) {
  useEffect(() => {
    // En la vista previa de AI Studio (modo desarrollo) no se precarga: cada pedido extra obliga al servidor
    // a compilar y calcular, y muchos pedidos juntos provocan "Rate exceeded". Solo en la versión publicada.
    if (process.env.NODE_ENV !== "production") return;
    const a = encodeURIComponent(agencia);
    const urls = [
      urlResultados(agencia, ejercicio), `/api/captaciones?agencia=${a}`, `/api/cartera-credito?agencia=${a}`,
      `/api/balance-general?agencia=${a}&ejercicio=${ejercicio}`, "/api/activos-por-agencia",
    ];
    // De a uno, con pausa: nunca más de un pedido en segundo plano a la vez.
    let vivo = true;
    const t = setTimeout(async () => {
      for (const u of urls) {
        if (!vivo) return;
        if (!tieneDatos(u)) { precargar([u]); await new Promise((r) => setTimeout(r, 1500)); }
      }
    }, 1500);
    return () => { vivo = false; clearTimeout(t); };
  }, [agencia, ejercicio]);
}

/** Ingresos, egresos y resultado del ejercicio (movimiento mensual). Una sola lectura del Estado de resultados. */
/**
 * Cuenta que calcula la herramienta desde otro módulo (seguros de Gastos anticipados, 450705 de Materiales, 530405 del
 * Fondo de liquidez): lo cargado a mano en cuentas que empiezan por `prefijo` no se usa y se muestra este valor.
 */
export interface CuentaCalculada { codigo: string; nombre: string; origen: string; prefijo: string; valores: number[] }
/** La cuenta calculada que reemplaza a una cuenta cargada a mano (o null). */
export const reemplazoDe = (calculadas: CuentaCalculada[], concepto: string) => {
  const c = concepto.replace(/\D/g, "");
  return calculadas.find((x) => c.startsWith(x.prefijo)) ?? null;
};

export function useResultados(agencia: string, ejercicio: number, version = 0) {
  const { datos: d, cargando } = useJSON<{ egresos?: Nodo; ingresos?: Nodo; resultadoDelEjercicio?: Nodo; calculadas?: CuentaCalculada[] }>(urlResultados(agencia, ejercicio), version);
  const r = useMemo(() => {
    const m = (n: unknown) => (n && (n as Nodo).valores ? desacumular(n as Nodo) : null);
    return { egresos: m(d?.egresos), ingresos: m(d?.ingresos), resultado: m(d?.resultadoDelEjercicio), calculadas: d?.calculadas ?? [] };
  }, [d]);
  return { ...r, cargando };
}

// ---------------------------------------------------------------------
// Exportar (CSV que abre en Excel)
// ---------------------------------------------------------------------

export interface FilaExport { codigo: string; cuenta: string; montos: number[] }

export function descargarCsv(_nombre: string, _filas: FilaExport[], ejercicio: number) {
  // Exporta a Excel lo que se ve en pantalla (lib/exportar-excel.ts): mismas filas y totales que la tabla.
  void _nombre; void _filas;
  void exportarPantalla({ ejercicio });
}

// ---------------------------------------------------------------------
// Encabezado: título + Exportar arriba; pestañas a la izquierda y Agencia a la derecha
// ---------------------------------------------------------------------

export function Encabezado({
  titulo, pestanas, activa, onPestana, agencia, onAgencia, onExportar, enlace, conConsolidado,
}: {
  titulo: string;
  pestanas: { id: string; label: string }[];
  activa: string; onPestana: (id: string) => void;
  agencia: string; onAgencia: (a: string) => void;
  onExportar?: () => void;
  enlace?: { href: string; texto: string };
  /** Agrega la opción "Consolidado" (suma de las 10 agencias) solo a este selector. */
  conConsolidado?: boolean;
}) {
  // Antes de cambiar de agencia o de pestaña se revisa si hay ediciones sin guardar
  const guardia = useGuardiaCambios();
  return (
    <div className="flex flex-col gap-3" style={F_TEXTO}>
      {guardia.dialogo}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight" style={{ color: C.texto }}>{titulo}<AnioEjercicio /></h1>
        <div className="flex items-center gap-5">
          {enlace && (
            <Link href={enlace.href} className="text-[13px] font-semibold hover:underline" style={{ color: C.acento }}>{enlace.texto}</Link>
          )}
          {onExportar && (
            <button onClick={onExportar} className="h-9 px-2.5 rounded flex items-center gap-1.5 text-[13px] font-semibold hover:bg-[#E3EEE7]" style={{ color: C.acento }}>
              <Download size={16} /> Exportar
            </button>
          )}
        </div>
      </div>
      <div className="flex items-end justify-between gap-4 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" className="flex gap-7 flex-wrap">
          {pestanas.map((p) => {
            const on = p.id === activa;
            return (
              <button key={p.id} onClick={() => { if (p.id !== activa) guardia.pedir(() => onPestana(p.id)); }}
                      role="tab" aria-selected={on} className="pt-2 pb-2.5 -mb-px text-[13px] whitespace-nowrap"
                      style={{ color: on ? C.acento : C.texto2, fontWeight: on ? 600 : 400, borderBottom: `2px solid ${on ? C.acento : "transparent"}` }}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="pb-2 flex items-center gap-2 shrink-0">
          <SelectorBaseMes />
          <span className="text-[12px] ml-3" style={{ color: C.texto2 }}>Agencia</span>
          <select value={agencia} onChange={(e) => { const a = e.target.value; guardia.pedir(() => onAgencia(a)); }}
                  className="h-9 px-2.5 text-[13px] rounded-md bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>
            {(conConsolidado ? [...AGENCIAS, "Consolidado"] : AGENCIAS).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Sub-pestañas pequeñas (hojas, Nómina/Resumen/Detalle). */
export function Chips({ items, activa, onElegir, children }: {
  items: { id: string; label: ReactNode }[]; activa: string | null; onElegir: (id: string) => void; children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" style={F_TEXTO}>
      {items.map((it) => {
        const on = it.id === activa;
        return (
          <button key={it.id} onClick={() => onElegir(it.id)} className="text-[11px] rounded-md px-3 py-1"
                  style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { color: C.texto2 }}>
            {it.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tarjetas limpias (sin gráficos ni flechas)
// ---------------------------------------------------------------------

export function Tarjetas({ items }: { items: { label: string; valor: string; detalle?: string }[] }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, ...F_TEXTO }}>
      {items.map((t) => (
        <div key={t.label} className="tarjeta px-5 py-4 flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: C.texto2 }}>{t.label}</span>
          <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{t.valor}</span>
          {t.detalle && <span className="text-[12px]" style={{ color: C.texto2 }}>{t.detalle}</span>}
        </div>
      ))}
    </div>
  );
}

export function TarjetasEgresos({ egresos, codigos, titulo, grupo, cargando }: {
  egresos: Nodo | null; codigos: string[]; titulo: string; grupo?: { label: string; codigo: string } | null; cargando?: boolean;
}) {
  if (cargando && !egresos) {
    return <Tarjetas items={[`${titulo} · anual`, grupo ? grupo.label : "Mes más alto", "Participación en el total de egresos"].map((l) => ({ label: l, valor: "…", detalle: "Calculando" }))} />;
  }
  const nodos = codigos.map((c) => buscarNodo(egresos, c)).filter((n): n is Nodo => !!n);
  const totalSeccion = suma(nodos.map((n) => suma(n.valores)));
  const totalEgresos = egresos ? suma(egresos.valores) : 0;
  const nodoGrupo = grupo ? buscarNodo(egresos, grupo.codigo) : null;
  const items = [
    { label: `${titulo} · anual`, valor: usd(totalSeccion), detalle: `Promedio mensual ${usd(totalSeccion / 12)}` },
    grupo
      ? { label: grupo.label, valor: usd(nodoGrupo ? suma(nodoGrupo.valores) : 0), detalle: totalSeccion ? `${pct((nodoGrupo ? suma(nodoGrupo.valores) : 0) / totalSeccion, 1)} de la sección` : undefined }
      : { label: "Mes más alto", valor: usd(Math.max(0, ...MESES.map((_, i) => suma(nodos.map((n) => n.valores[i] ?? 0))))), detalle: undefined },
    { label: "Participación en el total de egresos", valor: totalEgresos ? pct(totalSeccion / totalEgresos, 1) : "—", detalle: `Total egresos ${usd(totalEgresos)}` },
  ];
  return <Tarjetas items={items} />;
}

// ---------------------------------------------------------------------
// Tabla: columnas fijas (sin scroll horizontal) y botón ƒ
// ---------------------------------------------------------------------

export const TABLA = "w-full table-fixed border-collapse text-[11px]";

/**
 * nombre | 12 meses | total | (acciones) | ƒ — como el Balance: nombre y total con ancho fijo y los meses se reparten el
 * resto, así la tabla llega hasta el borde sin espacio en blanco al final.
 */
export function Columnas({ acciones = true }: { acciones?: boolean }) {
  return (
    <colgroup>
      <col style={{ width: 320 }} />
      {MESES.map((m) => <col key={m} />)}
      <col style={{ width: 90 }} />
      {acciones && <col style={{ width: 56 }} />}
      <col style={{ width: 28 }} />
    </colgroup>
  );
}

/**
 * Botones de una fila (editar, eliminar…) dentro de la celda del nombre, al pasar el mouse: no ocupan una columna
 * vacía al final. La fila necesita la clase `group` y la celda `relative`. `fijo` los deja siempre visibles (edición).
 */
export function AccionesFila({ children, fijo }: { children: ReactNode; fijo?: boolean }) {
  // la celda reserva el espacio de los íconos (globals.css, «acciones-N»): el nombre se acorta y no queda debajo
  const n = Math.min(4, Children.toArray(children).filter(Boolean).length);
  return (
    // siempre visibles (en gris suave; al pasar el mouse, con su color)
    <span className={`acciones-fila acciones-${n} absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2 rounded bg-white group-hover:bg-[#F5F7F6] ${fijo ? "" : "opacity-60 group-hover:opacity-100"}`}>
      {children}
    </span>
  );
}
/** Columnas reales de la tabla (nombre + 12 meses + total + acciones? + ƒ), para los colSpan de ancho completo. */
export const COLS_TOTALES = (acciones = true) => (acciones ? 16 : 15);

export function Cabecera({ titulo, ejercicio, acciones = true }: { titulo: ReactNode; ejercicio: number; acciones?: boolean }) {
  return (
    <thead>
      <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
        <th className="pl-4 py-2.5 text-left font-semibold text-[11px]" style={{ color: C.texto }}>{titulo}</th>
        {MESES.map((m) => <th key={m} className="px-1.5 py-2.5 text-right font-semibold">{etiquetaMes(m, ejercicio)}</th>)}
        <th className="px-2 py-2.5 text-right font-semibold">Total</th>
        {acciones && <th />}
        <th />
      </tr>
    </thead>
  );
}

export function BotonF({ abierto, onClick }: { abierto: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Ver fórmula" title="Ver fórmula"
            className="w-6 h-6 rounded-md text-[13px] italic leading-none"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", ...(abierto ? { background: C.acentoSuave, color: C.acento } : { color: C.tenue }) }}>
      ƒ
    </button>
  );
}

/**
 * Nombre de cuenta: el código va en una columna fija a la izquierda y el nombre empieza siempre en el mismo punto,
 * así las subfilas (productos, subcuentas) quedan alineadas con el título aunque no tengan código.
 */
export function NombreCuenta({ codigo, label, marca, estilo, ancho = 58 }: {
  codigo?: string; label: string; marca?: string; estilo?: React.CSSProperties; ancho?: number;
}) {
  return (
    <span className="flex items-center min-w-0 pr-2" title={`${codigo ?? ""} ${label}`.trim()}>
      <span className="shrink-0 flex items-center text-[10px] text-left" style={{ width: ancho, color: C.tenue }}>
        {codigo ?? ""}
        {marca && <span className="inline-block w-2 h-2 rounded-sm ml-auto mr-2" style={{ background: marca }} />}
      </span>
      <span className="truncate" style={{ color: C.texto3, ...estilo }}>{label}</span>
    </span>
  );
}

/** Celda de monto: gris claro cuando es cero. */
export function Celda({ v, fuerte }: { v: number; fuerte?: boolean }) {
  const cero = Math.round(v) === 0;
  return (
    <td className="px-1.5 text-right whitespace-nowrap" style={{ color: cero ? C.cero : fuerte ? C.texto : C.texto3, fontWeight: fuerte ? 600 : 400 }}>
      {cifra(v)}
    </td>
  );
}

/** Fila desplegada bajo una fila (fórmula o edición). */
export function FilaPanel({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-3" style={{ background: C.crema, borderTop: `1px solid ${C.beige}`, ...F_TEXTO }}>
        {children}
      </td>
    </tr>
  );
}

/** Selector de mes para las fórmulas. */
export function SelectorMes({ mes, onMes }: { mes: number; onMes: (i: number) => void }) {
  return (
    <div className="flex gap-0.5 flex-wrap mb-2">
      {MESES.map((m, i) => (
        <button key={m} onClick={() => onMes(i)} className="text-[10px] rounded px-1.5 py-0.5"
                style={i === mes ? { background: C.acento, color: "#fff" } : { color: C.texto2 }}>
          {m}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tabla de solo lectura (cuentas calculadas por los motores: 41, 44, 4505)
// ---------------------------------------------------------------------

export function TablaCalculada({
  titulo, raiz, ejercicio, formula, vacio,
}: {
  titulo: string; raiz: Nodo | null; ejercicio: number;
  formula: (n: Nodo, mes: number) => string;
  vacio: string;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(0);
  const ver = useVerMes();
  if (!raiz || !raiz.valores?.length) {
    return <p className="text-[12px] py-6" style={{ color: C.texto2, ...F_TEXTO }}>{vacio}</p>;
  }
  // Filas: cada hijo; si un hijo tiene subcuentas, va como título aparte y sus subcuentas con sangría.
  type F = { n: Nodo; nivel: number; titulo: boolean };
  const filas: F[] = [];
  const hijos = raiz.hijos?.length ? raiz.hijos : [raiz];
  for (const h of hijos) {
    if (h.hijos?.length) {
      filas.push({ n: h, nivel: 0, titulo: true });
      for (const s of h.hijos) filas.push({ n: s, nivel: 1, titulo: false });
    } else {
      filas.push({ n: h, nivel: 0, titulo: false });
    }
  }
  const cols = COLS_TOTALES(false);
  return (
    <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
      <table className={TABLA} style={F_TABLA}>
        <Columnas acciones={false} />
        <Cabecera titulo={titulo} ejercicio={ejercicio} acciones={false} />
        <tbody>
          {filas.map((f, k) => {
            const id = `${f.n.codigo}-${k}`;
            return (
              <Fragment key={id}>
                <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: f.titulo && k > 0 ? `1px solid ${C.borde}` : `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4">
                    <NombreCuenta codigo={f.n.codigo} label={f.n.label} ancho={f.n.codigo.length > 4 ? 60 : 44}
                                  estilo={f.titulo ? { color: C.acento, fontWeight: 700, fontSize: 12 } : undefined} />
                  </td>
                  {MESES.map((_, i) => <Celda key={i} v={ver(f.n.valores)[i] ?? 0} fuerte={f.titulo} />)}
                  <Celda v={suma(f.n.valores)} fuerte />
                  <td className="text-center"><BotonF abierto={abierta === id} onClick={() => setAbierta(abierta === id ? null : id)} /></td>
                </tr>
                {abierta === id && (
                  <FilaPanel colSpan={cols}>
                    <SelectorMes mes={mes} onMes={setMes} />
                    <p className="text-[11px]" style={{ color: C.texto2 }}>{formula(f.n, mes)}</p>
                  </FilaPanel>
                )}
              </Fragment>
            );
          })}
          <tr style={{ borderTop: `1px solid #B9C3BD`, height: 34 }}>
            <td className="pl-4 font-bold" style={{ color: C.texto }}>Total {raiz.codigo} · {raiz.label}</td>
            {MESES.map((_, i) => <Celda key={i} v={ver(raiz.valores)[i] ?? 0} fuerte />)}
            <Celda v={suma(raiz.valores)} fuerte />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Análisis: bloque, selector y tabla mensual (montos o %)
// ---------------------------------------------------------------------

export function Bloque({ titulo, children, derecha }: { titulo: string; children: ReactNode; derecha?: ReactNode }) {
  return (
    <section className="tarjeta px-5 py-4 flex flex-col gap-3" style={F_TEXTO}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[14px] font-bold" style={{ color: C.acento }}>{titulo}</h2>
        {derecha}
      </div>
      {children}
    </section>
  );
}

/** Control segmentado (selector de análisis), mismo estilo que el de Estado de resultados. */
export function Segmentado<T extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap self-start p-[3px] gap-0.5 rounded-lg bg-white" style={{ border: "1px solid #D5DBD7", ...F_TEXTO }}>
      {opciones.map((v) => {
        const on = v.id === valor;
        return (
          <button key={v.id} type="button" aria-pressed={on} onClick={() => onChange(v.id)}
                  className="h-8 px-3.5 rounded text-[12px] transition-colors"
                  style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { color: C.texto2 }}>
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Tabla mensual genérica para análisis (montos o %) ----------
export interface FilaA { id: string; label: string; valores: number[]; total: number; esPct?: boolean; clave?: boolean; formula: (i: number) => string }
export function TablaAnalisis({ titulo, filas, ejercicio }: { titulo: string; filas: FilaA[]; ejercicio: number }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(0);
  const txt = (f: FilaA, v: number) => (f.esPct ? (v ? pct(v, 1) : "—") : cifra(v));
  return (
    <table className={TABLA} style={F_TABLA}>
      <Columnas acciones={false} />
      <Cabecera titulo={titulo} ejercicio={ejercicio} acciones={false} />
      <tbody>
        {filas.map((f) => (
          <Fragment key={f.id}>
            <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: f.clave ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: 32, fontWeight: f.clave ? 600 : 400 }}>
              <td className="pl-4 pr-2 truncate" title={f.label} style={{ color: f.clave ? C.texto : C.texto3, ...F_TEXTO, fontSize: 11 }}>{f.label}</td>
              {MESES.map((_, i) => (
                <td key={i} className="px-1.5 text-right whitespace-nowrap" style={{ color: !f.esPct && Math.round(f.valores[i]) === 0 ? C.cero : f.clave ? C.texto : C.texto3 }}>{txt(f, f.valores[i])}</td>
              ))}
              <td className="px-1.5 text-right whitespace-nowrap font-semibold" style={{ color: C.texto }}>{txt(f, f.total)}</td>
              <td className="text-center"><BotonF abierto={abierta === f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} /></td>
            </tr>
            {abierta === f.id && (
              <FilaPanel colSpan={COLS_TOTALES(false)}>
                <SelectorMes mes={mes} onMes={setMes} />
                <p className="text-[11px]" style={{ color: C.texto2 }}>{f.formula(mes)}</p>
              </FilaPanel>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------
// Paneles de línea (evolución mensual)
// ---------------------------------------------------------------------

export function variacionTexto(v: number[]) {
  const d = v[11] - v[0];
  const r = v[0] ? d / v[0] : 0;
  return `${d >= 0 ? "+" : "−"}${usd(Math.abs(d))} (${r >= 0 ? "+" : "−"}${pct(Math.abs(r), 1)}) de enero a diciembre`;
}

/** Línea de 2 px con área suave; al pasar el cursor, guía vertical, punto y valor del mes. */
export function PanelLinea({ titulo, color, valores, ejercicio, formato = usd, resumen, detalle }: {
  titulo: string; color: string; valores: number[]; ejercicio: number;
  /** Cómo se muestran los valores (montos por defecto; pct para tasas). */
  formato?: (v: number) => string;
  /** Cifra grande del panel (por defecto, el total del año) y línea de detalle. */
  resumen?: string; detalle?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const min = Math.min(...valores), max = Math.max(...valores);
  const holgura = (max - min) * 0.25 || Math.max(1, max * 0.05);
  const lo = Math.max(0, min - holgura), hi = max + holgura;
  const x = (i: number) => ((i + 0.5) / 12) * 100;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo || 1)) * 100;
  const puntos = valores.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div className="rounded-lg px-4 pt-3 pb-2" style={{ border: `1px solid ${C.beige}` }}>
      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: C.texto2 }}>
        <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />{titulo}
      </div>
      <p className="text-[18px] font-semibold leading-tight mt-1" style={{ color: C.texto }}>{resumen ?? usd(suma(valores))}</p>
      <p className="text-[11px]" style={{ color: C.texto2 }}>{detalle ?? variacionTexto(valores)}</p>
      <div className="relative h-[99px] mt-3" onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <line x1={0} x2={100} y1={100} y2={100} stroke={C.borde} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <polygon points={`${x(0)},100 ${puntos} ${x(11)},100`} fill={color} opacity={0.08} />
          <polyline points={puntos} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover !== null && (
          <>
            <div className="absolute top-0 bottom-0 w-px" style={{ left: `${x(hover)}%`, background: C.borde }} />
            <div className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(hover)}%`, top: `${y(valores[hover])}%`, background: color, boxShadow: "0 0 0 2px #fff" }} />
            <div className="absolute -top-1 px-2 py-1 rounded-md bg-white text-[11px] whitespace-nowrap pointer-events-none"
                 style={{ border: `1px solid ${C.borde}`, color: C.texto, left: `${x(hover)}%`, transform: `translateX(${hover > 7 ? "-105%" : "8px"})` }}>
              {MESES[hover]} {ejercicio} · <b>{formato(valores[hover])}</b>
            </div>
          </>
        )}
        <div className="absolute inset-0 flex">
          {MESES.map((m, i) => <div key={m} className="flex-1" onMouseEnter={() => setHover(i)} />)}
        </div>
      </div>
      <EjeMeses />
    </div>
  );
}

/** Etiquetas de mes en texto normal (nítidas), mismo estilo que las pestañas. */
function EjeMeses() {
  return (
    <div className="flex mt-1.5">
      {MESES.map((m) => <span key={m} className="flex-1 text-center text-[11px]" style={{ color: C.texto2, ...F_TEXTO }}>{m}</span>)}
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirmación (eliminar)
// ---------------------------------------------------------------------

export function Confirmacion({ mensaje, onSi, onNo }: { mensaje: string; onSi: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" style={F_TEXTO}>
      <div className="bg-white rounded-xl max-w-sm w-full p-5" style={{ border: `1px solid ${C.borde}` }}>
        <p className="text-[12px] mb-2" style={{ color: C.texto }}>{mensaje}</p>
        <p className="text-[11px] mb-4" style={{ color: C.texto2 }}>Se borra de la herramienta y de la base de datos; no se puede deshacer.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onNo} className="text-[12px] px-4 py-1.5 rounded-lg" style={{ border: `1px solid ${C.borde}`, color: C.texto2 }}>Cancelar</button>
          <button onClick={() => { onSi(); onNo(); }} className="text-[12px] px-4 py-1.5 rounded-lg text-white" style={{ background: C.alerta }}>Sí, eliminar</button>
        </div>
      </div>
    </div>
  );
}

export function Cargando() {
  return <EsqueletoTabla indicadores={false} filas={8} />;
}

/** Botón de texto verde (acciones de barra: + Nuevo registro, Cargar histórico...). */
export function BotonTexto({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="text-[11px] font-semibold hover:underline disabled:opacity-50" style={{ color: C.acento, ...F_TEXTO }}>
      {children}
    </button>
  );
}

/** Botón principal (Guardar). */
export function BotonGuardar({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="text-[11px] font-semibold text-white rounded-lg px-4 py-1.5 disabled:opacity-50" style={{ background: C.acento, ...F_TEXTO }}>
      {children}
    </button>
  );
}
export function BotonSecundario({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="text-[11px] rounded-lg px-4 py-1.5 bg-white disabled:opacity-50" style={{ border: `1px solid ${C.borde}`, color: C.texto2, ...F_TEXTO }}>
      {children}
    </button>
  );
}

/** Estilo de los campos en edición. */
export const INPUT = "w-full text-right text-[11px] rounded px-1 py-1 bg-white";
export const INPUT_STYLE = { border: `1px solid ${BORDE_EDICION}` } as const;
