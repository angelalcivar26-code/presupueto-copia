"use client";

import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { cargarJSON, precargarEnSerie, pasosGrupoHojas } from "../../lib/useDatos";
import { useEffect, useState, Suspense } from "react";
import { Encabezado, TarjetasEgresos, useEgresos, descargarCsv, type FilaExport } from "../../components/EgresosComun";
import { TablaCalculada, Cargando, buscarNodo, urlResultados, MESES, usd } from "../../components/EgresosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { PAGINA, PAGINA_STYLE, usePrecargaEgresos } from "../../components/EgresosComun";
import HojasGrupo, { type FilaActivo } from "../../components/EgresosHojas";
import { EsqueletoTabla } from "../../components/Carga";

/**
 * OTROS GASTOS: 42 Comisiones causadas, 47 Otros gastos y pérdidas, 48 Impuestos y participación a empleados.
 * Captura por hojas (mismo esquema de Gastos operacionales). Estilo institucional.
 */

const GRUPOS = [
  { id: "42", label: "42 · Comisiones causadas" },
  { id: "47", label: "47 · Otros gastos y pérdidas" },
  { id: "48", label: "48 · Impuestos y participación a empleados" },
];

function OtrosGastosContenido() {
  const [ejercicio] = useEjercicio();
  const [grupoActivo, setGrupoActivo] = useState("42");
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [activos, setActivos] = useState<FilaActivo[]>([]);
  const [version, setVersion] = useState(0);
  const { egresos, cargando } = useEgresos(agencia, ejercicio, version);
  usePrecargaEgresos(agencia, ejercicio);
  // Las demás pestañas (42, 47, 48) se preparan por detrás (solo en la versión publicada).
  useEffect(() => (agencia === "Consolidado" ? undefined : precargarEnSerie(["42", "47", "48"].flatMap((g) => pasosGrupoHojas(g, agencia, ejercicio)))), [agencia, ejercicio]);
  const [filasExport, setFilasExport] = useState<FilaExport[]>([]);
  // Consolidado (suma de las 10 agencias): solo lectura, las cifras salen del Estado de resultados sumado.
  const esConsolidado = agencia === "Consolidado";
  useEffect(() => {
    if (!esConsolidado) return;
    const n = buscarNodo(egresos, grupoActivo);
    const hojas = n?.hijos?.length ? n.hijos : n ? [n] : [];
    setFilasExport(hojas.map((h) => ({ codigo: h.codigo, cuenta: h.label, montos: h.valores })));
  }, [esConsolidado, egresos, grupoActivo]);

  useEffect(() => {
    cargarJSON<{ filas?: FilaActivo[] }>("/api/activos-por-agencia", (d) => setActivos(d.filas ?? [])).catch(() => undefined);
  }, []);

  const grupoInfo = GRUPOS.find((g) => g.id === grupoActivo)!;

  return (
    <div className={PAGINA} style={PAGINA_STYLE}>
      <Encabezado
        titulo="Otros gastos"
        pestanas={GRUPOS}
        activa={grupoActivo}
        onPestana={(id) => { setGrupoActivo(id); setFilasExport([]); }}
        agencia={agencia}
        onAgencia={setAgencia}
        onExportar={() => descargarCsv(`Otros gastos ${grupoActivo} - ${agencia} ${ejercicio}`, filasExport, ejercicio)}
        conConsolidado
      />
      <AvisoConsolidado url={urlResultados(agencia, ejercicio)} agencia={agencia} />
      {<TarjetasEgresos egresos={egresos} cargando={cargando} codigos={["42", "47", "48"]} titulo="Otros gastos" grupo={{ codigo: grupoActivo, label: grupoInfo.label }} />}
      {esConsolidado ? (cargando ? <Cargando /> : (
        <TablaCalculada
          titulo={`${grupoInfo.label} · Consolidado`}
          raiz={buscarNodo(egresos, grupoActivo)}
          ejercicio={ejercicio}
          vacio={`El Estado de resultados consolidado todavía no trae la cuenta ${grupoActivo}.`}
          formula={(n, mes) => `${n.codigo} ${n.label}: suma de lo presupuestado en las 10 agencias. ${MESES[mes]} = ${usd(n.valores[mes] ?? 0)}.`}
        />
      )) : (
        <HojasGrupo key={grupoActivo} grupo={grupoActivo} agencia={agencia} ejercicio={ejercicio} activos={activos}
                    onCambio={() => setVersion((v) => v + 1)} onExport={setFilasExport} />
      )}
    </div>
  );
}

export default function OtrosGastosPage() {
  return (
    <Suspense fallback={<div className="estilo-institucional min-h-screen px-6 py-6" style={{ background: "#EEF1EF" }}><EsqueletoTabla filas={10} /></div>}>
      <OtrosGastosContenido />
    </Suspense>
  );
}
