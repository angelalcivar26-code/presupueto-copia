"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { pedirJSON } from "../../lib/useDatos";
import { C, FONDO, Tarjeta } from "../../components/ActivosComun";

/**
 * CATÁLOGO DE CUENTAS (Administración). Consulta del catálogo guardado en la base de datos
 * (tabla catalogo_cuentas): buscar por código o por nombre, o ver un grupo completo en
 * jerarquía (cada cuenta se despliega para ver las subcuentas que la integran).
 * Solo lectura: el catálogo se usa para autocompletar códigos en Ingresos y Egresos.
 */

interface Cuenta { codigo: string; nombre: string; grupo: string | number | null; nivel: number | null; agrupacion?: boolean }

const GRUPOS = [
  { id: "1", label: "1 · Activo" }, { id: "2", label: "2 · Pasivo" }, { id: "3", label: "3 · Patrimonio" },
  { id: "4", label: "4 · Gastos" }, { id: "5", label: "5 · Ingresos" }, { id: "6", label: "6 · Contingentes" }, { id: "7", label: "7 · De orden" },
];
const LIMITE = 500;

/** Nombres de las cuentas de 2 dígitos del Catálogo Único (SEPS). Se usan como agrupación cuando
 *  el catálogo cargado trae las subcuentas (ej. 1401) pero no la cuenta madre (14). */
const CUENTAS_2: Record<string, string> = {
  "11": "Fondos disponibles", "12": "Operaciones interfinancieras", "13": "Inversiones", "14": "Cartera de créditos",
  "15": "Deudores por aceptaciones", "16": "Cuentas por cobrar", "17": "Bienes realizables, adjudicados por pago y no utilizados",
  "18": "Propiedades y equipo", "19": "Otros activos",
  "21": "Obligaciones con el público", "22": "Operaciones interfinancieras", "23": "Obligaciones inmediatas", "24": "Aceptaciones en circulación",
  "25": "Cuentas por pagar", "26": "Obligaciones financieras", "27": "Valores en circulación", "28": "Obligaciones convertibles y aportes para capitalización",
  "29": "Otros pasivos",
  "31": "Capital social", "32": "Prima o descuento en colocación de acciones", "33": "Reservas", "34": "Otros aportes patrimoniales",
  "35": "Superávit por valuaciones", "36": "Resultados",
  "41": "Intereses causados", "42": "Comisiones causadas", "43": "Pérdidas financieras", "44": "Provisiones", "45": "Gastos de operación",
  "46": "Otras pérdidas operacionales", "47": "Otros gastos y pérdidas", "48": "Impuestos y participación a empleados",
  "51": "Intereses y descuentos ganados", "52": "Comisiones ganadas", "53": "Utilidades financieras", "54": "Ingresos por servicios",
  "55": "Otros ingresos operacionales", "56": "Otros ingresos", "59": "Pérdidas y ganancias",
};

export default function CatalogoCuentasPage() {
  const [texto, setTexto] = useState("");
  const [grupo, setGrupo] = useState("1");
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const q = texto.trim() || grupo;

  useEffect(() => {
    setError(null);
    let vivo = true;
    const t = setTimeout(() => {
      pedirJSON(`/api/catalogo-cuentas?q=${encodeURIComponent(q)}&limite=${LIMITE}`)
        .then((d) => { if (!vivo) return; if (d.error) setError(d.error); else setCuentas(d.cuentas ?? []); })
        .catch(() => { if (vivo) setError("No se pudo leer el catálogo. Recarga la página."); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [q]);

  // Por grupo solo se muestran las cuentas de ese grupo (la búsqueda por nombre podría traer otras)
  const lista = useMemo(() => {
    const base = (cuentas ?? []).filter((c) => texto.trim() || String(c.codigo).startsWith(grupo));
    if (texto.trim()) return base;
    // Completa las cuentas de 2 dígitos que falten para que todo quede agrupado (ej. 14 Cartera de créditos)
    const hay = new Set(base.map((c) => String(c.codigo)));
    const faltan = new Set(base.map((c) => String(c.codigo)).filter((c) => c.length > 2).map((c) => c.slice(0, 2)).filter((c) => !hay.has(c)));
    const extra: Cuenta[] = [...faltan].map((c) => ({ codigo: c, nombre: CUENTAS_2[c] ?? `Cuenta ${c}`, grupo, nivel: 2, agrupacion: true }));
    return [...base, ...extra].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  }, [cuentas, texto, grupo]);
  const nivelDe = (c: Cuenta) => c.nivel ?? String(c.codigo).replace(/\D/g, "").length;
  const buscando = !!texto.trim();

  // Jerarquía por código: la cuenta "madre" es el código más largo de la lista que sea prefijo del código.
  const { madre, hijos } = useMemo(() => {
    const codigos = new Set(lista.map((c) => String(c.codigo)));
    const madre = new Map<string, string | null>();
    const hijos = new Map<string, number>();
    for (const c of lista) {
      const cod = String(c.codigo);
      let m: string | null = null;
      for (let k = cod.length - 1; k >= 1; k--) { if (codigos.has(cod.slice(0, k))) { m = cod.slice(0, k); break; } }
      madre.set(cod, m);
      if (m) hijos.set(m, (hijos.get(m) ?? 0) + 1);
    }
    return { madre, hijos };
  }, [lista]);
  // Profundidad dentro del árbol (0 = primer nivel visible del grupo)
  const profundidad = (cod: string) => { let d = 0, m = madre.get(cod); while (m) { d++; m = madre.get(m); } return d; };
  // Visible si todas sus madres están desplegadas (al buscar se ve todo)
  const visible = (cod: string) => { if (buscando) return true; let m = madre.get(cod); while (m) { if (!abiertas.has(m)) return false; m = madre.get(m); } return true; };
  const conHijos = [...hijos.keys()];
  const todoAbierto = conHijos.length > 0 && conHijos.every((c) => abiertas.has(c));
  const alternar = (cod: string) => setAbiertas((a) => { const n = new Set(a); if (n.has(cod)) n.delete(cod); else n.add(cod); return n; });
  const filasVisibles = lista.filter((c) => visible(String(c.codigo)));

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Catálogo de cuentas</h1>
      </div>

      {/* Grupos a la izquierda, buscador a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Grupos" className="flex flex-wrap gap-x-7 flex-1">
          {GRUPOS.map((g) => {
            const activa = !texto.trim() && grupo === g.id;
            return (
              <button key={g.id} type="button" role="tab" aria-selected={activa} onClick={() => { setGrupo(g.id); setTexto(""); setAbiertas(new Set()); }}
                      className="pt-2 pb-2.5 -mb-px text-[13px]"
                      style={{ color: activa ? C.acento : C.texto2, fontWeight: activa ? 600 : 400, borderBottom: `2px solid ${activa ? C.acento : "transparent"}` }}>
                {g.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          <span className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.tenue }} />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar código o nombre" aria-label="Buscar código o nombre"
                   className="h-9 w-[234px] pl-8 pr-2.5 text-[13px] rounded-md bg-white outline-none focus:ring-2 focus:ring-[#E3EEE7]"
                   style={{ border: "1px solid #C9D0CC", color: C.texto }} />
          </span>
        </label>
      </div>

      <Tarjeta titulo={texto.trim() ? `Resultados para “${texto.trim()}”` : GRUPOS.find((g) => g.id === grupo)?.label ?? "Cuentas"}
        derecha={cuentas && <>
          <span className="text-[12px]" style={{ color: C.texto2 }}>{(cuentas ?? []).length.toLocaleString("es-EC")}{(cuentas ?? []).length >= LIMITE ? "+" : ""} cuentas</span>
          {!buscando && conHijos.length > 0 && (
            <button type="button" onClick={() => setAbiertas(todoAbierto ? new Set() : new Set(conHijos))}
                    className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]" style={{ color: C.acento }}>
              {todoAbierto ? <><ChevronsDownUp className="w-4 h-4" /> Contraer todo</> : <><ChevronsUpDown className="w-4 h-4" /> Desplegar todo</>}
            </button>
          )}
        </>}>
        {error ? (
          <p className="px-4 py-4 text-[12px]" style={{ color: C.alerta }}>{error}</p>
        ) : !cuentas ? (
          <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>Leyendo el catálogo...</p>
        ) : lista.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px]" style={{ color: C.texto2 }}>No hay cuentas que coincidan.</p>
        ) : (
          <table className="w-full table-fixed text-[11px] border-collapse">
            <colgroup><col style={{ width: 144 }} /><col /><col style={{ width: 81 }} /></colgroup>
            <thead>
              <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
                <th className="pl-4 text-left font-semibold">Código</th>
                <th className="px-3 text-left font-semibold">Nombre</th>
                <th className="pr-4 text-right font-semibold">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((c) => {
                const cod = String(c.codigo);
                const n = nivelDe(c);
                const d = buscando ? Math.max(0, Math.min(4, n - 2)) : profundidad(cod);
                const nHijos = buscando ? 0 : hijos.get(cod) ?? 0;
                const abierta = abiertas.has(cod);
                const titulo = !buscando ? d === 0 : n <= 2;
                return (
                  <tr key={cod} onClick={nHijos ? () => alternar(cod) : undefined}
                      className={nHijos ? "cursor-pointer hover:bg-[#F5F7F6]" : "hover:bg-[#F5F7F6]"}
                      style={{ borderTop: `1px solid ${C.beige}`, height: 31 }}>
                    <td className="pl-4" style={{ color: titulo ? C.acento : C.texto2, fontWeight: titulo ? 700 : 400 }}>{cod}</td>
                    <td className="px-3" style={{ paddingLeft: 11 + d * 22 }}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        {nHijos ? (
                          <button type="button" aria-expanded={abierta} aria-label={`${abierta ? "Contraer" : "Desplegar"} ${c.nombre}`}
                                  onClick={(e) => { e.stopPropagation(); alternar(cod); }}
                                  className="w-5 h-5 rounded inline-flex items-center justify-center shrink-0 hover:bg-[#E3EEE7]" style={{ color: C.acento }}>
                            <ChevronRight className="w-4 h-4 transition-transform" style={{ transform: abierta ? "rotate(90deg)" : undefined }} />
                          </button>
                        ) : !buscando && <span className="w-5 shrink-0" />}
                        <span className="truncate" title={c.agrupacion ? `${c.nombre} (agrupación: esta cuenta no está en el catálogo cargado)` : c.nombre} style={{ color: titulo ? C.acento : C.texto3, fontWeight: titulo ? 700 : nHijos ? 600 : 400 }}>{c.nombre}</span>
                        {nHijos > 0 && !abierta && <span className="text-[10px] shrink-0" style={{ color: C.tenue }}>{nHijos} {nHijos === 1 ? "subcuenta" : "subcuentas"}</span>}
                      </span>
                    </td>
                    <td className="pr-4 text-right" style={{ color: C.texto2 }}>{n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}
