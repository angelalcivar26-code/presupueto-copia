"use client";
/**
 * Resumen de un grupo (4502, 4503, 54…) como árbol contable, igual que el Estado de resultados:
 * cuenta madre (4 y 6 dígitos) con su total y, al desplegarla, sus cuentas de detalle. Sin subtotales ni títulos de hoja:
 * el árbol se arma con el código de cada cuenta, no con el nombre de la hoja donde se cargó.
 * Las cuentas que calcula la herramienta desde otro módulo (seguros de Gastos anticipados, 450705 de Materiales…) entran
 * con ese valor y reemplazan lo cargado a mano, igual que en el motor. Al final compara el total con el Estado de resultados.
 * Plegado: sin negrita; una cuenta desplegada va en negrita. "Expandir todo" lo maneja la pantalla (botón junto a Agregar).
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useDatos } from "../lib/useDatos";
import {
  MESES, C, F_TABLA, TABLA, Columnas, Cabecera, COLS_TOTALES, NombreCuenta, cifra, usd, suma, buscarNodo, reemplazoDe,
  type Nodo, type CuentaCalculada,
} from "./EgresosComun";
import { useVerMes } from "./EgresosComun";

interface LineaArbol { concepto: string; cuenta_nombre: string | null; montosPorMes: number[]; calculadaEn?: string; hoja?: string; enHojas?: { hoja: string; total: number }[] }

const digitos = (c: string) => c.replace(/\D/g, "");
const cero = (v: number) => Math.round(v) === 0;
/** Niveles del árbol bajo el grupo: 4 y 6 dígitos (los que sean más largos que el grupo). */
const nivelesDe = (grupo: string) => [4, 6].filter((n) => n > grupo.length);

interface NodoArbol { codigo: string; nombre: string; valores: number[]; hijos: NodoArbol[]; linea?: LineaArbol; er: number | null }

function Valor({ v, fuerte, suave }: { v: number; fuerte?: boolean; suave?: boolean }) {
  return (
    <td className="px-1.5 text-right whitespace-nowrap"
        style={{ color: cero(v) ? C.cero : fuerte ? C.texto : suave ? C.texto2 : C.texto3, fontWeight: fuerte ? 600 : 400 }}>
      {cero(v) ? "—" : cifra(v)}
    </td>
  );
}

export default function ResumenArbol({ grupo, etiqueta, lineas, ejercicio, nodoER, hojas = [], calculadas = [], expandido = false }: {
  grupo: string; etiqueta: string; lineas: LineaArbol[]; ejercicio: number;
  /** Nodo del grupo en el Estado de resultados (valores mensuales): nombres de las cuentas madre y control de cuadre. */
  nodoER?: Nodo | null;
  /** Nombres de hojas ("450325 - Seguros"): último recurso para nombrar una cuenta madre. */
  hojas?: string[];
  /** Cuentas calculadas desde otro módulo (del Estado de resultados): reemplazan lo cargado a mano. */
  calculadas?: CuentaCalculada[];
  /** Expandir todo (lo maneja la pantalla); cada cuenta se puede abrir o cerrar después. */
  expandido?: boolean;
}) {
  // lo que el usuario abrió o cerró a mano; se reinicia al cambiar "Expandir todo" (la pantalla cambia la key)
  const [manual, setManual] = useState<Map<string, boolean>>(new Map());
  const verMes = useVerMes();
  const cat = useDatos<{ cuentas?: { codigo: string; nombre: string }[] }>(`/api/catalogo-cuentas?q=${grupo}&limite=500`, 0);

  // lo cargado en las hojas, sin las cuentas que calcula la herramienta, más esas cuentas con su valor calculado
  const usadas = useMemo<LineaArbol[]>(() => {
    const delGrupo = calculadas.filter((c) => c.codigo.startsWith(grupo));
    return [
      ...lineas.filter((l) => !reemplazoDe(delGrupo, l.concepto)),
      ...delGrupo.map((c) => ({ concepto: c.codigo, cuenta_nombre: c.nombre, montosPorMes: c.valores, calculadaEn: c.origen })),
    ];
  }, [lineas, calculadas, grupo]);

  const arbol = useMemo(() => {
    const nombreCat = new Map((cat.datos?.cuentas ?? []).map((c) => [String(c.codigo), String(c.nombre)]));
    const nombre = (cod: string) => buscarNodo(nodoER, cod)?.label || nombreCat.get(cod)
      || hojas.map((h) => h.match(/^\s*(\d{4,})\s*[-–·.]?\s*(.*)$/)).find((m) => m && m[1] === cod)?.[2] || "";
    // profundidades a las que llega el Estado de resultados: si trae ese nivel y no trae la cuenta, para el ER vale 0
    // (solo para cuentas de detalle: el ER puede mezclar niveles, ej. 450705 junto a cuentas de 8 dígitos)
    const largosER = new Set<number>();
    const marcar = (n: Nodo | null | undefined) => { for (const h of n?.hijos ?? []) { if (!h.hijos?.length) largosER.add(h.codigo.length); marcar(h); } };
    marcar(nodoER);
    const erDe = (cod: string, detalle = false) => {
      const n = buscarNodo(nodoER, cod);
      return n ? suma(n.valores) : detalle && nodoER && largosER.has(cod.length) ? 0 : null;
    };
    const niveles = nivelesDe(grupo);
    const armar = (lista: LineaArbol[], nivel: number): NodoArbol[] => {
      const largo = niveles[nivel];
      if (largo === undefined) {
        // último nivel: cada cuenta; la misma cuenta cargada en dos hojas se muestra una sola vez, sumada
        const porCuenta = new Map<string, LineaArbol>();
        for (const l of lista) {
          const k = digitos(l.concepto), y = porCuenta.get(k);
          // de qué hojas viene cada cuenta (para avisar cuando se carga en más de una y se suma)
          const parte = l.hoja ? [{ hoja: l.hoja, total: suma(l.montosPorMes) }] : [];
          porCuenta.set(k, y ? { ...y, montosPorMes: y.montosPorMes.map((v, i) => v + (l.montosPorMes[i] ?? 0)), enHojas: [...(y.enHojas ?? []), ...parte] } : { ...l, enHojas: parte });
        }
        return [...porCuenta.entries()].sort(([a], [b]) => a.localeCompare(b))
          .map(([codigo, l]) => ({ codigo, nombre: l.cuenta_nombre ?? "", valores: l.montosPorMes, hijos: [], linea: l, er: erDe(codigo, true) }));
      }
      const porCod = new Map<string, LineaArbol[]>();
      for (const l of lista) { const k = digitos(l.concepto).slice(0, largo); porCod.set(k, [...(porCod.get(k) ?? []), l]); }
      return [...porCod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, ls]) => {
        // una cuenta cargada directamente con el código de este nivel: no se repite debajo
        const directa = ls.length === 1 && digitos(ls[0].concepto) === codigo;
        return {
          codigo, nombre: nombre(codigo) || (ls.length === 1 ? ls[0].cuenta_nombre ?? "" : ""), hijos: directa ? [] : armar(ls, nivel + 1),
          valores: MESES.map((_, i) => suma(ls.map((l) => l.montosPorMes[i] ?? 0))), er: erDe(codigo, directa),
          ...(directa ? { linea: ls[0] } : {}),
        };
      });
    };
    return armar(usadas, 0);
  }, [usadas, nodoER, hojas, grupo, cat.datos]);

  const plegables: NodoArbol[] = [], todos: NodoArbol[] = [];
  const recorrer = (ns: NodoArbol[]) => ns.forEach((n) => { todos.push(n); if (n.hijos.length) { plegables.push(n); recorrer(n.hijos); } });
  recorrer(arbol);
  const totales = MESES.map((_, i) => suma(arbol.map((m) => m.valores[i])));
  const ver = verMes;
  const total = suma(totales);
  const abierto = (c: string) => manual.get(c) ?? (expandido || (arbol.length === 1 && arbol[0].codigo === c));
  const alternar = (c: string) => setManual((s) => new Map(s).set(c, !abierto(c)));

  // Control con el Estado de resultados: la diferencia se señala en la cuenta más baja que la tiene
  const totalER = nodoER ? suma(nodoER.valores) : null;
  const conDif = (n: NodoArbol) => n.er !== null && Math.abs(n.er - suma(n.valores)) >= 1;
  const difs = todos.filter((n) => conDif(n) && !n.hijos.some(conDif));
  const codigosArbol = new Set(todos.map((n) => n.codigo));
  const soloER: Nodo[] = [];
  const buscarSoloER = (ns: Nodo[] | undefined) => (ns ?? []).forEach((h) => {
    if (cero(suma(h.valores))) return;
    if (!codigosArbol.has(h.codigo)) soloER.push(h); else buscarSoloER(h.hijos);
  });
  buscarSoloER(nodoER?.hijos);
  const cuadra = totalER !== null && Math.abs(totalER - total) < 1;
  const cols = COLS_TOTALES(false);

  if (!arbol.length) return <p className="text-[12px] px-4 py-6" style={{ color: C.texto2 }}>Todavía no hay cuentas cargadas en este grupo.</p>;

  return (
    <table className={TABLA} style={F_TABLA}>
      <Columnas acciones={false} />
      <Cabecera ejercicio={ejercicio} acciones={false} titulo="Cuenta" />
      <tbody>
        {arbol.map((n) => <Rama key={n.codigo} n={n} nivel={0} abierto={abierto} alternar={alternar} conDif={conDif} />)}
        <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
          <td className="pl-6"><NombreCuenta codigo={grupo} label={etiqueta} estilo={{ color: C.texto, fontWeight: 700 }} /></td>
          {ver(totales).map((v, i) => <Valor key={i} v={v} fuerte />)}
          <Valor v={total} fuerte />
          <td />
        </tr>
        {totalER !== null && (
          <tr style={{ borderTop: `1px solid ${C.beige}` }}>
            <td colSpan={cols} className="pl-6 pr-4 py-2 text-[11px]" style={{ color: C.texto2, fontFamily: '"Segoe UI", system-ui, sans-serif' }}>
              {cuadra ? (
                <span>Estado de resultados {grupo}: <b style={{ color: C.texto }}>{usd(totalER)}</b> · <span style={{ color: C.ok }}>cuadra ✓</span></span>
              ) : (
                <span className="flex flex-col gap-0.5">
                  <span>Estado de resultados {grupo}: <b style={{ color: C.texto }}>{usd(totalER)}</b> · <b style={{ color: C.alerta }}>diferencia {usd(total - totalER)}</b></span>
                  {difs.map((m) => (
                    <span key={m.codigo}>{m.codigo} {m.nombre}: aquí {usd(suma(m.valores))}, en el Estado de resultados {usd(m.er!)}</span>
                  ))}
                  {soloER.map((h) => (
                    <span key={h.codigo}>{h.codigo} {h.label}: {usd(suma(h.valores))} está en el Estado de resultados pero en ninguna hoja</span>
                  ))}
                </span>
              )}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Una cuenta del árbol y, si está desplegada, sus subcuentas (recursivo). En negrita solo la cuenta desplegada. */
function Rama({ n, nivel, abierto, alternar, conDif }: {
  n: NodoArbol; nivel: number; abierto: (c: string) => boolean; alternar: (c: string) => void; conDif: (n: NodoArbol) => boolean;
}) {
  const ver = useVerMes();
  const plegable = n.hijos.length > 0;
  const ab = plegable && abierto(n.codigo);
  const detalle = nivel > 0 && !plegable;
  const dif = conDif(n) && !n.hijos.some(conDif);
  const origen = n.linea?.calculadaEn;
  // la misma cuenta con valores en más de una hoja: se suma; se avisa para revisar que no esté duplicada
  const varias = (n.linea?.enHojas ?? []).filter((x) => Math.abs(x.total) >= 0.5);
  const enVarias = varias.length > 1 ? varias : null;
  return (
    <>
      <tr className={plegable ? "cursor-pointer hover:bg-[#F5F7F6]" : "hover:bg-[#F5F7F6]"} onClick={plegable ? () => alternar(n.codigo) : undefined}
          aria-expanded={plegable ? ab : undefined}
          style={{ borderTop: `1px solid ${C.beige}`, height: detalle ? 30 : 32, background: nivel > 0 ? "#FBFCFB" : undefined }}>
        <td style={{ paddingLeft: 8 + nivel * 18 }}>
          <span className="flex items-center min-w-0">
            <span className="w-4 shrink-0 flex justify-center" style={{ color: C.tenue }}>
              {plegable && <ChevronRight size={13} style={{ transform: ab ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />}
            </span>
            <NombreCuenta codigo={n.codigo} label={n.nombre} ancho={n.codigo.length > 6 ? 66 : 58}
                          estilo={{ color: detalle ? C.texto2 : C.texto, fontWeight: ab ? 600 : 400 }} />
            {origen && <span className="shrink-0 text-[10px] mr-2 italic" style={{ color: C.tenue }} title={`La calcula la herramienta: ${origen}`}>{origen.replace(/\s*\(.*\)$/, "")}</span>}
            {enVarias && <span className="shrink-0 text-[10px] font-semibold mr-2 px-1.5 rounded" style={{ background: C.avisoSuave, color: C.aviso }}
                                title={`Cargada en ${enVarias.length} hojas, se suman: ${enVarias.map((x) => `${x.hoja.replace(/^\s*\d{4,}\s*[-–·.]?\s*/, "")} ${usd(x.total)}`).join(" · ")}`}>{enVarias.length} hojas</span>}
            {dif && <span className="shrink-0 w-1.5 h-1.5 rounded-full mr-2" style={{ background: C.alerta }}
                          title={`Estado de resultados: ${usd(n.er!)} · diferencia ${usd(suma(n.valores) - n.er!)}`} />}
          </span>
        </td>
        {ver(n.valores).map((v, i) => <Valor key={i} v={v} fuerte={ab} suave={detalle} />)}
        <Valor v={suma(n.valores)} fuerte={ab} suave={detalle} />
        <td />
      </tr>
      {ab && n.hijos.map((h) => <Rama key={h.codigo} n={h} nivel={nivel + 1} abierto={abierto} alternar={alternar} conDif={conDif} />)}
    </>
  );
}
