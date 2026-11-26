"use client";

import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { cargarJSON } from "../../lib/useDatos";
import { Fragment, Suspense, useMemo, useState } from "react";
import {
  MESES, AGENCIAS, C, F_TABLA, F_TEXTO, PAGINA, PAGINA_STYLE, suma, cifra, usd, pct,
  TABLA, Columnas, Cabecera, COLS_TOTALES, BotonF, Celda, FilaPanel, SelectorMes, Encabezado, Tarjetas, Cargando,
  BotonTexto, NombreCuenta, PanelLinea, Bloque, TablaAnalisis, Segmentado, type FilaA, variacionTexto, useResultados, urlResultados, useJSON, usePrecargaEgresos, buscarNodo, descargarCsv, type Nodo, type FilaExport,
} from "../../components/EgresosComun";
import { useVerMes } from "../../components/EgresosComun";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

/**
 * INTERESES CAUSADOS (grupo 41). Solo lectura: no se captura nada aquí.
 * - Tabla de datos: 41 del Estado de resultados, con 4101 desglosado por producto (motor de Obligaciones con el público).
 * - Análisis: peso en saldo vs. costo, costo efectivo, costo de fondeo, % sobre ingresos, margen y spread,
 *   sensibilidad de tasas (simulación, no guarda) y comparación entre agencias (bajo pedido).
 * Fuentes: /api/estado-resultados, /api/captaciones, /api/balance-general.
 */

type Clave = "vista" | "crecer" | "dpf";
const PRODUCTOS: { clave: Clave; label: string; corto: string; color: string }[] = [
  { clave: "vista", label: "Ahorro a la vista", corto: "A la vista", color: "#56B07A" },
  { clave: "crecer", label: "Ahorro crecer", corto: "Crecer", color: "#C38A03" },
  { clave: "dpf", label: "Depósitos a plazo fijo", corto: "Plazo fijo", color: "#005A28" },
];

interface DetMes {
  mes: number; saldoInicial: number; saldoFinal: number;
  depositos: number; retiros: number; capitalizacionInteres: number; cancelaciones: number; renovaciones: number;
  tasas: { tasaInteresAnual: number };
  /** Interés del mes calculado por agencia (en el Consolidado, suma de las agencias). */
  interesCausado?: number;
}
type Detalle = Record<Clave, DetMes[]>;

/** Interés del mes por producto: mismo cálculo del motor (Obligaciones con el público y orquestador). */
function interesMes(k: Clave, d: DetMes): number {
  if (d.interesCausado !== undefined) return d.interesCausado;
  if (k === "dpf") return ((d.saldoInicial + d.saldoFinal) / 2) * (d.tasas.tasaInteresAnual / 12);
  return d.capitalizacionInteres;
}
const saldoPromedio = (d: DetMes) => (d.saldoInicial + d.saldoFinal) / 2;

interface Serie { interes: number[]; saldoProm: number[]; tasa: number[] }
function series(det: Detalle | null): Record<Clave, Serie> | null {
  if (!det?.vista?.length) return null;
  const r = {} as Record<Clave, Serie>;
  for (const p of PRODUCTOS) {
    const d = det[p.clave] ?? [];
    r[p.clave] = {
      interes: MESES.map((_, i) => (d[i] ? interesMes(p.clave, d[i]) : 0)),
      saldoProm: MESES.map((_, i) => (d[i] ? saldoPromedio(d[i]) : 0)),
      // tasa efectiva del mes = interés × 12 ÷ saldo promedio (en el Consolidado, el promedio ponderado de las agencias)
      tasa: MESES.map((_, i) => { const m = d[i]; if (!m) return 0; const sp = saldoPromedio(m); return sp > 0 ? interesMes(p.clave, m) * 12 / sp : m.tasas.tasaInteresAnual; }),
    };
  }
  return r;
}
/** Costo efectivo anual: intereses del año ÷ saldo promedio del año. */
const costoEfectivo = (s: Serie) => { const prom = suma(s.saldoProm) / 12; return prom ? suma(s.interes) / prom : 0; };
const div = (a: number, b: number) => (b ? a / b : 0);

// =====================================================================
// PÁGINA
// =====================================================================

function InteresesCausadosContenido() {
  const [ejercicio] = useEjercicio();
  const [pestana, setPestana] = useState<"tabla" | "analisis">("tabla");
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const { egresos, ingresos, resultado, cargando: cargandoER } = useResultados(agencia, ejercicio);
  usePrecargaEgresos(agencia, ejercicio);
  const q = `agencia=${encodeURIComponent(agencia)}`;
  const cap = useJSON<{ detalle?: Detalle }>(`/api/captaciones?${q}`);
  const bal = useJSON<{ activo?: Nodo }>(`/api/balance-general?${q}&ejercicio=${ejercicio}`);
  const det = cap.datos?.detalle ?? null;
  const cartera = useMemo(() => buscarNodo(bal.datos?.activo, "14")?.valores ?? null, [bal.datos]);
  const cargandoCap = cap.cargando || bal.cargando;

  const s = useMemo(() => series(det), [det]);
  const n41 = buscarNodo(egresos, "41");
  // Muestra lo que ya tenga (memoria) sin esperar a las otras lecturas.
  const cargando = (cargandoER && !egresos) || (cargandoCap && !det);

  function exportar() {
    const filas: FilaExport[] = [];
    for (const h of n41?.hijos ?? []) {
      filas.push({ codigo: h.codigo, cuenta: h.label, montos: h.valores });
      if (h.codigo === "4101" && s) for (const p of PRODUCTOS) filas.push({ codigo: "4101", cuenta: `  ${p.label}`, montos: s[p.clave].interes });
    }
    if (n41) filas.push({ codigo: "41", cuenta: "Total intereses causados", montos: n41.valores });
    descargarCsv(`Intereses causados - ${agencia} ${ejercicio}`, filas, ejercicio);
  }

  return (
    <div className={PAGINA} style={PAGINA_STYLE}>
      <Encabezado
        titulo="Intereses causados"
        pestanas={[{ id: "tabla", label: "Tabla de datos" }, { id: "analisis", label: "Análisis" }]}
        activa={pestana} onPestana={(id) => setPestana(id as "tabla" | "analisis")}
        agencia={agencia} onAgencia={setAgencia} conConsolidado
        onExportar={exportar}
        enlace={agencia === "Consolidado" ? undefined : { href: "/captaciones", texto: "Editar tasas en Obligaciones con el público" }}
      />
      <AvisoConsolidado url={urlResultados(agencia, ejercicio)} agencia={agencia} />
      {cargando ? <Cargando /> : !n41 ? (
        <p className="text-[13px]" style={{ color: C.texto2, ...F_TEXTO }}>El Estado de resultados todavía no trae la cuenta 41 para {agencia}.</p>
      ) : pestana === "tabla" ? (
        <>
          <TarjetasTabla n41={n41} egresos={egresos} s={s} />
          <TablaIntereses n41={n41} s={s} det={det} ejercicio={ejercicio} consolidado={agencia === "Consolidado"} />
        </>
      ) : (
        <Analisis n41={n41} s={s} ingresos={ingresos} resultado={resultado} cartera={cartera} ejercicio={ejercicio} agencia={agencia} />
      )}
    </div>
  );
}

function TarjetasTabla({ n41, egresos, s }: { n41: Nodo; egresos: Nodo | null; s: Record<Clave, Serie> | null }) {
  const total = suma(n41.valores);
  const totalEgresos = egresos ? suma(egresos.valores) : 0;
  const dpf = s ? suma(s.dpf.interes) : 0;
  return (
    <Tarjetas items={[
      { label: "Intereses causados · anual", valor: usd(total), detalle: `Promedio mensual ${usd(total / 12)}` },
      { label: "Depósitos a plazo fijo", valor: usd(dpf), detalle: total ? `${pct(dpf / total, 1)} de los intereses` : undefined },
      { label: "Participación en el total de egresos", valor: totalEgresos ? pct(total / totalEgresos, 1) : "—", detalle: `Total egresos ${usd(totalEgresos)}` },
    ]} />
  );
}

// =====================================================================
// TABLA DE DATOS: 41 con 4101 desglosado por producto
// =====================================================================

function TablaIntereses({ n41, s, det, ejercicio, consolidado }: { n41: Nodo; s: Record<Clave, Serie> | null; det: Detalle | null; ejercicio: number; consolidado: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(0);
  const ver = useVerMes();
  const cols = COLS_TOTALES(false);
  const hijos = n41.hijos?.length ? n41.hijos : [n41];

  type F = { id: string; codigo: string; label: string; valores: number[]; tipo: "titulo" | "producto" | "cuenta" | "diferencia"; formula: (i: number) => string };
  const filas: F[] = [];
  for (const h of hijos) {
    if (h.codigo === "4101" && s && det) {
      filas.push({ id: h.codigo, codigo: h.codigo, label: h.label, valores: h.valores, tipo: "titulo",
        formula: (i) => `${h.label} = Ahorro a la vista + Ahorro crecer + Depósitos a plazo fijo. ${MESES[i]} = ${PRODUCTOS.map((p) => usd(s[p.clave].interes[i])).join(" + ")} = ${usd(h.valores[i])}.` });
      for (const p of PRODUCTOS) {
        const d = det[p.clave];
        filas.push({
          id: `p-${p.clave}`, codigo: "", label: p.label, valores: s[p.clave].interes, tipo: "producto",
          formula: (i) => {
            const m = d[i];
            if (!m) return "Sin datos.";
            if (consolidado) return `Suma de las 10 agencias, cada una con su propia tasa: ${usd(s[p.clave].interes[i])}. Tasa efectiva = interés × 12 ÷ saldo promedio = ${usd(s[p.clave].interes[i])} × 12 ÷ ${usd(s[p.clave].saldoProm[i])} = ${pct(s[p.clave].tasa[i])}.`;
            return p.clave === "dpf"
              ? `(Saldo inicial + saldo final) ÷ 2 × tasa anual ÷ 12 = (${usd(m.saldoInicial)} + ${usd(m.saldoFinal)}) ÷ 2 × ${pct(m.tasas.tasaInteresAnual)} ÷ 12 = ${usd(s.dpf.interes[i])}. Va al gasto; no se suma al saldo del depósito.`
              : `Interés capitalizado del mes que calcula el motor de Obligaciones con el público con una tasa anual de ${pct(m.tasas.tasaInteresAnual)} sobre un saldo inicial de ${usd(m.saldoInicial)}: ${usd(m.capitalizacionInteres)}. Se suma al saldo del socio.`;
          },
        });
      }
      const dif = h.valores.map((v, i) => v - suma(PRODUCTOS.map((p) => s[p.clave].interes[i])));
      if (dif.some((x) => Math.abs(x) >= 1)) {
        filas.push({ id: "dif", codigo: "", label: "Diferencia con el Estado de resultados", valores: dif, tipo: "diferencia",
          formula: (i) => `4101 del Estado de resultados (${usd(h.valores[i])}) − suma de los productos (${usd(h.valores[i] - dif[i])}) = ${usd(dif[i])}. Debe ser 0; si no lo es, avísame para revisar el motor.` });
      }
    } else {
      filas.push({ id: h.codigo, codigo: h.codigo, label: h.label, valores: h.valores, tipo: "cuenta",
        formula: (i) => `${h.codigo} ${h.label}: tomado del Estado de resultados. ${MESES[i]} = ${usd(h.valores[i])}.` });
    }
  }

  return (
    <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
      <table className={TABLA} style={F_TABLA}>
        <Columnas acciones={false} />
        <Cabecera titulo="Intereses causados" ejercicio={ejercicio} acciones={false} />
        <tbody>
          {filas.map((f, k) => (
            <Fragment key={f.id}>
              <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: f.tipo === "titulo" && k > 0 ? `1px solid ${C.borde}` : `1px solid ${C.beige}`, height: 32 }}>
                <td className="pl-4">
                  <NombreCuenta codigo={f.codigo} label={f.label}
                                marca={f.tipo === "producto" ? PRODUCTOS.find((p) => `p-${p.clave}` === f.id)?.color : undefined}
                                estilo={f.tipo === "titulo" ? { color: C.acento, fontWeight: 700, fontSize: 12 } : f.tipo === "diferencia" ? { color: C.alerta } : undefined} />
                </td>
                {MESES.map((_, i) => <Celda key={i} v={ver(f.valores)[i] ?? 0} fuerte={f.tipo === "titulo"} />)}
                <Celda v={suma(f.valores)} fuerte />
                <td className="text-center"><BotonF abierto={abierta === f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} /></td>
              </tr>
              {abierta === f.id && (
                <FilaPanel colSpan={cols}>
                  <SelectorMes mes={mes} onMes={setMes} />
                  <p className="text-[11px]" style={{ color: C.texto2 }}>{f.formula(mes)}</p>
                </FilaPanel>
              )}
            </Fragment>
          ))}
          <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
            <td className="pl-4 font-bold" style={{ color: C.texto }}>Total 41 · Intereses causados</td>
            {MESES.map((_, i) => <Celda key={i} v={ver(n41.valores)[i] ?? 0} fuerte />)}
            <Celda v={suma(n41.valores)} fuerte />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// =====================================================================
// ANÁLISIS
// =====================================================================

type VistaAnalisis = "peso" | "evolucion" | "ingresos" | "spread" | "sensibilidad" | "agencias";
const VISTAS: { id: VistaAnalisis; label: string }[] = [
  { id: "peso", label: "Saldo vs. costo" },
  { id: "evolucion", label: "Evolución mensual" },
  { id: "ingresos", label: "Ingresos y margen" },
  { id: "spread", label: "Spread financiero" },
  { id: "sensibilidad", label: "Sensibilidad de tasas" },
  { id: "agencias", label: "Comparación entre agencias" },
];

function Analisis({ n41, s, ingresos, resultado, cartera, ejercicio, agencia }: {
  n41: Nodo; s: Record<Clave, Serie> | null; ingresos: Nodo | null; resultado: Nodo | null;
  cartera: number[] | null; ejercicio: number; agencia: string;
}) {
  const [vista, setVista] = useState<VistaAnalisis>("peso");
  if (!s) return <p className="text-[13px]" style={{ color: C.texto2, ...F_TEXTO }}>No se pudo leer la proyección de Obligaciones con el público de {agencia}.</p>;

  const interesesAnio = suma(n41.valores);
  const captProm = suma(MESES.map((_, i) => suma(PRODUCTOS.map((p) => s[p.clave].saldoProm[i])))) / 12;
  const costoFondeo = div(suma(PRODUCTOS.map((p) => suma(s[p.clave].interes))), captProm);
  const n51 = buscarNodo(ingresos, "51");
  const ganados = n51 ? suma(n51.valores) : 0;
  const caro = [...PRODUCTOS].sort((a, b) => costoEfectivo(s[b.clave]) - costoEfectivo(s[a.clave]))[0];

  return (
    <div className="flex flex-col gap-5">
      <Tarjetas items={[
        { label: "Costo de fondeo", valor: pct(costoFondeo), detalle: `Intereses ÷ captaciones promedio (${usd(captProm)})` },
        { label: "Intereses causados ÷ intereses ganados", valor: n51 ? pct(div(interesesAnio, ganados), 1) : "—", detalle: n51 ? `De cada $100 ganados se pagan $${(div(interesesAnio, ganados) * 100).toFixed(0)}` : "Sin cuenta 51" },
        { label: "Margen financiero bruto", valor: n51 ? usd(ganados - interesesAnio) : "—", detalle: "Intereses ganados (51) − causados (41)" },
        { label: "Producto más caro", valor: caro.corto, detalle: `Costo efectivo ${pct(costoEfectivo(s[caro.clave]))}` },
      ]} />

      <Segmentado opciones={VISTAS} valor={vista} onChange={setVista} etiqueta="Tipo de análisis" />

      {vista === "peso" && <PesoVsCosto s={s} />}
      {vista === "evolucion" && <Evolucion s={s} ejercicio={ejercicio} />}
      {vista === "ingresos" && <SobreIngresos n41={n41} ingresos={ingresos} ejercicio={ejercicio} />}
      {vista === "spread" && <Spread n41={n41} s={s} ingresos={ingresos} cartera={cartera} ejercicio={ejercicio} />}
      {vista === "sensibilidad" && <Sensibilidad s={s} ganados={ganados} resultado={resultado} />}
      {vista === "agencias" && <ComparacionAgencias ejercicio={ejercicio} />}
    </div>
  );
}

// ---------- 1 y 2. Peso en saldo vs. peso en costo, costo efectivo ----------
function PesoVsCosto({ s }: { s: Record<Clave, Serie> }) {
  const [abierta, setAbierta] = useState<Clave | null>(null);
  const saldoTot = suma(PRODUCTOS.map((p) => suma(s[p.clave].saldoProm) / 12));
  const intTot = suma(PRODUCTOS.map((p) => suma(s[p.clave].interes)));
  const filas = PRODUCTOS.map((p) => {
    const sp = suma(s[p.clave].saldoProm) / 12;
    const it = suma(s[p.clave].interes);
    const tasaProm = suma(s[p.clave].tasa) / 12;
    return { p, sp, it, pSaldo: div(sp, saldoTot), pCosto: div(it, intTot), costo: costoEfectivo(s[p.clave]), tasaProm };
  });
  const th = "px-3 py-2.5 text-right font-semibold";
  return (
    <Bloque titulo="Peso en el saldo vs. peso en el costo">
      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
        <table className="w-full table-fixed border-collapse text-[11px]" style={F_TABLA}>
          <colgroup><col style={{ width: "24%" }} /><col /><col /><col /><col /><col /><col /><col style={{ width: 32 }} /></colgroup>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
              <th className="pl-1 py-2.5 text-left font-semibold">Producto</th>
              <th className={th}>Saldo promedio</th><th className={th}>% del saldo</th>
              <th className={th}>Intereses año</th><th className={th}>% del costo</th>
              <th className={th}>Tasa pactada</th><th className={th}>Costo efectivo</th><th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <Fragment key={f.p.clave}>
                <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32, color: C.texto3 }}>
                  <td className="pl-1"><span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: f.p.color }} />{f.p.label}</span></td>
                  <td className="px-3 text-right">{cifra(f.sp)}</td>
                  <td className="px-3 text-right">{pct(f.pSaldo, 1)}</td>
                  <td className="px-3 text-right">{cifra(f.it)}</td>
                  <td className="px-3 text-right" style={{ color: C.texto, fontWeight: 600 }}>{pct(f.pCosto, 1)}</td>
                  <td className="px-3 text-right">{pct(f.tasaProm)}</td>
                  <td className="px-3 text-right" style={{ color: C.texto, fontWeight: 600 }}>{pct(f.costo)}</td>
                  <td className="text-center"><BotonF abierto={abierta === f.p.clave} onClick={() => setAbierta(abierta === f.p.clave ? null : f.p.clave)} /></td>
                </tr>
                {abierta === f.p.clave && (
                  <FilaPanel colSpan={8}>
                    <p className="text-[11px]" style={{ color: C.texto2 }}>
                      % del saldo = {usd(f.sp)} ÷ {usd(saldoTot)} = {pct(f.pSaldo, 1)} · % del costo = {usd(f.it)} ÷ {usd(intTot)} = {pct(f.pCosto, 1)} · Costo efectivo = intereses del año ÷ saldo promedio = {usd(f.it)} ÷ {usd(f.sp)} = {pct(f.costo)} (tasa pactada promedio {pct(f.tasaProm)}).
                      {" "}Por cada 1 % del saldo que aporta, se lleva {(div(f.pCosto, f.pSaldo)).toLocaleString("es-EC", { maximumFractionDigits: 2 })} % del costo.
                    </p>
                  </FilaPanel>
                )}
              </Fragment>
            ))}
            <tr style={{ borderTop: "1px solid #B9C3BD", height: 34, fontWeight: 700, color: C.texto }}>
              <td className="pl-1">Total</td>
              <td className="px-3 text-right">{cifra(saldoTot)}</td><td className="px-3 text-right">100 %</td>
              <td className="px-3 text-right">{cifra(intTot)}</td><td className="px-3 text-right">100 %</td>
              <td /><td className="px-3 text-right">{pct(div(intTot, saldoTot))}</td><td />
            </tr>
          </tbody>
        </table>

        {/* Barras pareadas: % del saldo (claro) frente a % del costo (sólido) */}
        <div className="flex flex-col gap-3 justify-center">
          {filas.map((f) => (
            <div key={f.p.clave} className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: C.texto3 }}>{f.p.corto}</span>
              {[{ v: f.pSaldo, t: "Saldo", op: 0.35 }, { v: f.pCosto, t: "Costo", op: 1 }].map((b) => (
                <div key={b.t} className="flex items-center gap-2 text-[10px]" style={{ color: C.texto2 }} title={`${f.p.label} · ${b.t}: ${pct(b.v, 1)}`}>
                  <span className="w-10 shrink-0">{b.t}</span>
                  <div className="flex-1 h-2.5 rounded-sm" style={{ background: C.crema }}>
                    <div className="h-2.5 rounded-r" style={{ width: `${Math.max(0, Math.min(1, b.v)) * 100}%`, background: f.p.color, opacity: b.op }} />
                  </div>
                  <span className="w-12 text-right" style={{ ...F_TABLA, color: C.texto }}>{pct(b.v, 1)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Bloque>
  );
}

// ---------- 7. Evolución mensual: un panel de línea por producto (cada uno con su propia escala) ----------
function Evolucion({ s, ejercicio }: { s: Record<Clave, Serie>; ejercicio: number }) {
  const totales = MESES.map((_, i) => suma(PRODUCTOS.map((p) => s[p.clave].interes[i])));
  return (
    <Bloque titulo="Evolución mensual por producto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {PRODUCTOS.map((p) => <PanelLinea key={p.clave} titulo={p.label} color={p.color} valores={s[p.clave].interes} ejercicio={ejercicio} />)}
      </div>
      <PanelTotal valores={totales} ejercicio={ejercicio} />
    </Bloque>
  );
}

/** Total 41 del mes, en una fila compacta debajo de los paneles. */
function PanelTotal({ valores, ejercicio }: { valores: number[]; ejercicio: number }) {
  return (
    <table className={TABLA} style={F_TABLA}>
      <Columnas acciones={false} />
      <Cabecera titulo="Total intereses causados" ejercicio={ejercicio} acciones={false} />
      <tbody>
        <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
          <td className="pl-4 text-[11px]" style={{ color: C.texto2, ...F_TEXTO }}>{variacionTexto(valores)}</td>
          {valores.map((v, i) => <Celda key={i} v={v} fuerte />)}
          <Celda v={suma(valores)} fuerte />
          <td />
        </tr>
      </tbody>
    </table>
  );
}

// ---------- 4 y 5. Cuánto se come de los ingresos / margen financiero ----------
function SobreIngresos({ n41, ingresos, ejercicio }: { n41: Nodo; ingresos: Nodo | null; ejercicio: number }) {
  const n51 = buscarNodo(ingresos, "51");
  if (!n51 || !ingresos) return <Bloque titulo="Cuánto se come de los ingresos"><p className="text-[12px]" style={{ color: C.texto2 }}>El Estado de resultados no trae la cuenta 51.</p></Bloque>;
  const g = n51.valores, c = n41.valores, t = ingresos.valores;
  const G = suma(g), Cc = suma(c), T = suma(t);
  const filas: FilaA[] = [
    { id: "g", label: "Intereses ganados (51)", valores: g, total: G, formula: (i) => `Cuenta 51 del Estado de resultados, movimiento de ${MESES[i]}: ${usd(g[i])}.` },
    { id: "c", label: "Intereses causados (41)", valores: c, total: Cc, formula: (i) => `Cuenta 41 del Estado de resultados, movimiento de ${MESES[i]}: ${usd(c[i])}.` },
    { id: "m", label: "Margen financiero bruto (51 − 41)", valores: g.map((x, i) => x - c[i]), total: G - Cc, clave: true, formula: (i) => `${usd(g[i])} − ${usd(c[i])} = ${usd(g[i] - c[i])}.` },
    { id: "p1", label: "Causados ÷ ganados", valores: g.map((x, i) => div(c[i], x)), total: div(Cc, G), esPct: true, formula: (i) => `${usd(c[i])} ÷ ${usd(g[i])} = ${pct(div(c[i], g[i]), 1)}. Año: ${usd(Cc)} ÷ ${usd(G)} = ${pct(div(Cc, G), 1)}.` },
    { id: "p2", label: "Causados ÷ ingresos totales", valores: t.map((x, i) => div(c[i], x)), total: div(Cc, T), esPct: true, formula: (i) => `${usd(c[i])} ÷ ingresos totales ${usd(t[i])} = ${pct(div(c[i], t[i]), 1)}. Año: ${pct(div(Cc, T), 1)}.` },
  ];
  return (
    <Bloque titulo="Cuánto se come de los ingresos">
      <TablaAnalisis titulo="Intereses frente a ingresos" filas={filas} ejercicio={ejercicio} />
    </Bloque>
  );
}

// ---------- 5. Spread: rendimiento de la cartera − costo de fondeo ----------
function Spread({ n41, s, ingresos, cartera, ejercicio }: { n41: Nodo; s: Record<Clave, Serie>; ingresos: Nodo | null; cartera: number[] | null; ejercicio: number }) {
  const n5104 = buscarNodo(ingresos, "5104");
  const capt = MESES.map((_, i) => suma(PRODUCTOS.map((p) => s[p.clave].saldoProm[i])));
  const costo = MESES.map((_, i) => div(n41.valores[i] * 12, capt[i]));
  const carProm = cartera ? cartera.map((v, i) => (i === 0 ? v : (v + cartera[i - 1]) / 2)) : null;
  const rend = n5104 && carProm ? MESES.map((_, i) => div(n5104.valores[i] * 12, carProm[i])) : null;
  const costoAnio = div(suma(n41.valores), suma(capt) / 12);
  const rendAnio = n5104 && carProm ? div(suma(n5104.valores), suma(carProm) / 12) : 0;
  const filas: FilaA[] = [
    ...(rend && n5104 && carProm ? [{ id: "r", label: "Rendimiento de la cartera", valores: rend, total: rendAnio, esPct: true,
      formula: (i: number) => `Intereses de cartera (5104) × 12 ÷ cartera promedio (grupo 14, neta de provisiones) = ${usd(n5104.valores[i])} × 12 ÷ ${usd(carProm[i])} = ${pct(rend[i])}.` }] : []),
    { id: "cf", label: "Costo de fondeo", valores: costo, total: costoAnio, esPct: true,
      formula: (i) => `Intereses causados (41) × 12 ÷ captaciones promedio (vista + crecer + plazo fijo) = ${usd(n41.valores[i])} × 12 ÷ ${usd(capt[i])} = ${pct(costo[i])}.` },
    ...(rend ? [{ id: "sp", label: "Spread financiero", valores: rend.map((r, i) => r - costo[i]), total: rendAnio - costoAnio, esPct: true, clave: true,
      formula: (i: number) => `Rendimiento de la cartera − costo de fondeo = ${pct(rend[i])} − ${pct(costo[i])} = ${pct(rend[i] - costo[i])}. Es lo que gana la cooperativa por cada dólar prestado, antes de provisiones y gastos operativos.` }] : []),
  ];
  return (
    <Bloque titulo="Spread financiero">
      {!rend && <p className="text-[11px]" style={{ color: C.texto2 }}>Falta la cuenta 5104 o el saldo de cartera (14) para calcular el rendimiento; se muestra solo el costo de fondeo.</p>}
      <TablaAnalisis titulo="Tasas anualizadas" filas={filas} ejercicio={ejercicio} />
    </Bloque>
  );
}

// ---------- 6. Sensibilidad de tasas (simulación; no guarda) ----------
function Sensibilidad({ s, ganados, resultado }: { s: Record<Clave, Serie>; ganados: number; resultado: Nodo | null }) {
  const [delta, setDelta] = useState<Record<Clave, number>>({ vista: 0, crecer: 0, dpf: 0 });
  const [verFormula, setVerFormula] = useState(false);
  /** Variación del interés = saldo promedio × Δ tasa ÷ 12, mes a mes (se mantiene el saldo proyectado). */
  const efecto = (k: Clave) => suma(s[k].saldoProm.map((sp) => (sp * delta[k]) / 12));
  const actual = suma(PRODUCTOS.map((p) => suma(s[p.clave].interes)));
  const cambio = suma(PRODUCTOS.map((p) => efecto(p.clave)));
  const res = resultado ? suma(resultado.valores) : null;
  const th = "px-3 py-2.5 text-right font-semibold";
  return (
    <Bloque titulo="Sensibilidad de tasas" derecha={<span className="flex items-center gap-4"><BotonTexto onClick={() => setDelta({ vista: 0, crecer: 0, dpf: 0 })}>Restablecer</BotonTexto><BotonF abierto={verFormula} onClick={() => setVerFormula((v) => !v)} /></span>}>
      <table className="w-full table-fixed border-collapse text-[11px]" style={F_TABLA}>
        <colgroup><col style={{ width: "20%" }} /><col style={{ width: "32%" }} /><col /><col /><col /><col /></colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
            <th className="pl-1 py-2.5 text-left font-semibold">Producto</th>
            <th className="px-3 py-2.5 text-left font-semibold">Cambio de tasa (puntos)</th>
            <th className={th}>Tasa promedio</th><th className={th}>Intereses año</th><th className={th}>Con el cambio</th><th className={th}>Variación</th>
          </tr>
        </thead>
        <tbody>
          {PRODUCTOS.map((p) => {
            const it = suma(s[p.clave].interes), e = efecto(p.clave), tp = suma(s[p.clave].tasa) / 12;
            return (
              <tr key={p.clave} style={{ borderTop: `1px solid ${C.beige}`, height: 36, color: C.texto3 }}>
                <td className="pl-1"><span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} />{p.label}</span></td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <input type="range" min={-1} max={1} step={0.05} value={delta[p.clave] * 100} aria-label={`Cambio de tasa ${p.label}`}
                           onChange={(e) => setDelta((d) => ({ ...d, [p.clave]: Number(e.target.value) / 100 }))} className="flex-1 accent-[#005A28]" />
                    <b className="w-16 text-right" style={{ color: C.texto }}>{delta[p.clave] >= 0 ? "+" : "−"}{Math.abs(delta[p.clave] * 100).toLocaleString("es-EC", { minimumFractionDigits: 2 })}</b>
                  </span>
                </td>
                <td className="px-3 text-right">{pct(tp)} → {pct(tp + delta[p.clave])}</td>
                <td className="px-3 text-right">{cifra(it)}</td>
                <td className="px-3 text-right">{cifra(it + e)}</td>
                <td className="px-3 text-right font-semibold" style={{ color: Math.round(e) === 0 ? C.cero : C.texto }}>{e > 0 ? "+" : ""}{cifra(e)}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: "1px solid #B9C3BD", height: 34, fontWeight: 700, color: C.texto }}>
            <td className="pl-1" colSpan={3}>Total intereses causados</td>
            <td className="px-3 text-right">{cifra(actual)}</td><td className="px-3 text-right">{cifra(actual + cambio)}</td>
            <td className="px-3 text-right">{cambio > 0 ? "+" : ""}{cifra(cambio)}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-3 gap-4 text-[12px]" style={{ color: C.texto2 }}>
        <p>Margen financiero bruto: <b style={{ color: C.texto }}>{usd(ganados - actual)} → {usd(ganados - actual - cambio)}</b></p>
        <p>Causados ÷ ganados: <b style={{ color: C.texto }}>{ganados ? `${pct(div(actual, ganados), 1)} → ${pct(div(actual + cambio, ganados), 1)}` : "—"}</b></p>
        <p>Resultado del ejercicio (antes de 48): <b style={{ color: C.texto }}>{res !== null ? `${usd(res)} → ${usd(res - cambio)}` : "—"}</b></p>
      </div>
      {verFormula && <p className="text-[11px] rounded-lg px-3 py-2" style={{ color: C.texto2, background: C.crema }}>
        Variación = saldo promedio proyectado de cada mes × cambio de tasa ÷ 12. Es exacta para plazo fijo; en ahorros es una aproximación porque no recalcula el interés que se capitaliza. Es solo una simulación: no guarda ni cambia las tasas.
      </p>}
    </Bloque>
  );
}

// ---------- 8. Comparación entre agencias (bajo pedido, para no leer la base sin necesidad) ----------
function ComparacionAgencias({ ejercicio }: { ejercicio: number }) {
  void ejercicio;
  const [filas, setFilas] = useState<{ agencia: string; capt: number; intereses: number; costo: number; pDpf: number }[] | null>(null);
  const [cargando, setCargando] = useState(false);
  async function calcular() {
    setCargando(true);
    try {
      const r = await Promise.all(AGENCIAS.map(async (a) => {
        const d = await new Promise<{ detalle?: Detalle } | null>((ok) => { cargarJSON<{ detalle?: Detalle }>(`/api/captaciones?agencia=${encodeURIComponent(a)}`, ok).catch(() => ok(null)); });
        const se = series(d?.detalle ?? null);
        if (!se) return { agencia: a, capt: 0, intereses: 0, costo: 0, pDpf: 0 };
        const capt = suma(MESES.map((_, i) => suma(PRODUCTOS.map((p) => se[p.clave].saldoProm[i])))) / 12;
        const intereses = suma(PRODUCTOS.map((p) => suma(se[p.clave].interes)));
        return { agencia: a, capt, intereses, costo: div(intereses, capt), pDpf: div(suma(se.dpf.interes), intereses) };
      }));
      setFilas(r.sort((x, y) => y.intereses - x.intereses));
    } finally {
      setCargando(false);
    }
  }
  const max = filas ? Math.max(1, ...filas.map((f) => f.intereses)) : 1;
  const th = "px-3 py-2.5 text-right font-semibold";
  return (
    <Bloque titulo="Comparación entre agencias" derecha={<BotonTexto onClick={calcular} disabled={cargando}>{cargando ? "Calculando..." : filas ? "Volver a calcular" : "Calcular las 10 agencias"}</BotonTexto>}>
      {!filas ? (
        <p className="text-[11px]" style={{ color: C.texto2 }}>Se calcula al presionar el botón, para no leer la base de las 10 agencias cada vez que se abre la pantalla.</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-[11px]" style={F_TABLA}>
          <colgroup><col style={{ width: "16%" }} /><col /><col /><col /><col /><col style={{ width: "30%" }} /></colgroup>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
              <th className="pl-1 py-2.5 text-left font-semibold">Agencia</th>
              <th className={th}>Captaciones promedio</th><th className={th}>Intereses año</th><th className={th}>Costo de fondeo</th><th className={th}>% del costo en plazo fijo</th>
              <th className="px-3 py-2.5 text-left font-semibold">Intereses año</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const sin = f.capt === 0;
              return (
                <tr key={f.agencia} style={{ borderTop: `1px solid ${C.beige}`, height: 31, color: sin ? C.tenue : C.texto3 }}>
                  <td className="pl-1">{f.agencia}</td>
                  {sin ? <td colSpan={5} className="px-3 italic" style={F_TEXTO}>Sin datos cargados</td> : (
                    <>
                      <td className="px-3 text-right">{cifra(f.capt)}</td>
                      <td className="px-3 text-right" style={{ color: C.texto, fontWeight: 600 }}>{cifra(f.intereses)}</td>
                      <td className="px-3 text-right">{pct(f.costo)}</td>
                      <td className="px-3 text-right">{pct(f.pDpf, 1)}</td>
                      <td className="px-3"><div className="h-2.5 rounded-r" style={{ width: `${(f.intereses / max) * 100}%`, background: C.acento }} title={`${f.agencia}: ${usd(f.intereses)}`} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Bloque>
  );
}

export default function InteresesCausadosPage() {
  return (
    <Suspense fallback={<div className="estilo-institucional min-h-screen px-6 py-6" style={{ background: "#EEF1EF" }}><EsqueletoTabla filas={10} /></div>}>
      <InteresesCausadosContenido />
    </Suspense>
  );
}
