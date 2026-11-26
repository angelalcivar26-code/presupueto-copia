"use client";

import { useCallback, useEffect, useState } from "react";

interface Fila {
  id: number; fecha: string; usuario: string; accion: string; pantalla: string; agencia: string | null; ejercicio: number | null; detalle: string;
  instantanea_id: number | null; restaurada_en: string | null; restaurada_por: string | null;
}

const claseInput = "h-9 px-3 rounded-lg border border-[#D5DAD7] bg-white text-[13px] text-[#111418] outline-none focus:border-[#005A28] focus:ring-2 focus:ring-[#005A28]/20";
const claseBoton = "h-9 px-4 rounded-lg text-[13px] font-semibold border border-[#D5DAD7] bg-white text-[#26302B] hover:bg-[#F4F6F5] disabled:opacity-50";

/** La base guarda la hora UTC; se muestra en la hora de Ecuador. */
function fechaLocal(f: string): string {
  const d = new Date(f.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? f : d.toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" });
}

function hoyMenos(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Bitácora de cambios: quién guardó qué, cuándo y dónde (últimos 12 meses). Solo administradores. */
export default function BitacoraPage() {
  const [desde, setDesde] = useState(hoyMenos(30));
  const [hasta, setHasta] = useState(hoyMenos(0));
  const [usuario, setUsuario] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ filas: Fila[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<number | null>(null);
  const [recarga, setRecarga] = useState(0);

  async function restaurar(f: Fila) {
    if (!f.instantanea_id) return;
    if (!window.confirm(`¿Restaurar lo eliminado?\n\n${f.detalle}\n\nVuelve tal como estaba el ${fechaLocal(f.fecha)}. Si después se creó algo con el mismo nombre, se reemplaza.`)) return;
    setRestaurando(f.id); setAviso(null); setError(null);
    try {
      const r = await fetch("/api/instantaneas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.instantanea_id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error ?? "No se pudo restaurar."); else { setAviso(d.mensaje); setRecarga((x) => x + 1); }
    } catch { setError("No hay conexión con el servidor."); }
    finally { setRestaurando(null); }
  }

  const consulta = useCallback((extra: Record<string, string>) => {
    const q = new URLSearchParams({ desde, hasta, ...(usuario.trim() ? { usuario: usuario.trim() } : {}), ...extra });
    return `/api/bitacora?${q}`;
  }, [desde, hasta, usuario]);

  useEffect(() => {
    let vivo = true;
    fetch(consulta({ pagina: String(pagina) }), { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!vivo) return; if (!r.ok) { setError(d.error ?? "No se pudo leer la bitácora."); setDatos(null); } else { setError(null); setDatos(d); } })
      .catch(() => { if (vivo) setError("No hay conexión con el servidor."); });
    return () => { vivo = false; };
  }, [consulta, pagina, recarga]);

  async function descargar() {
    setDescargando(true);
    try {
      const r = await fetch(consulta({ todo: "1" }), { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "No se pudo descargar."); return; }
      const XLSX = await import("xlsx");
      const filas = (d.filas as Fila[]).map((f) => ({
        "Fecha y hora": fechaLocal(f.fecha), Usuario: f.usuario, Acción: f.accion, Pantalla: f.pantalla,
        Agencia: f.agencia ?? "", Ejercicio: f.ejercicio ?? "", Detalle: f.detalle,
      }));
      const hoja = XLSX.utils.aoa_to_sheet([
        ["Cooperativa de Ahorro y Crédito Once de Junio Ltda."],
        [`Bitácora de cambios · del ${desde} al ${hasta}${usuario.trim() ? ` · usuario ${usuario.trim()}` : ""}`],
        [],
      ]);
      XLSX.utils.sheet_add_json(hoja, filas, { origin: "A4" });
      hoja["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 11 }, { wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 70 }];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Bitácora");
      XLSX.writeFile(libro, `bitacora_${desde}_a_${hasta}.xlsx`);
    } catch {
      setError("No se pudo generar el archivo.");
    } finally { setDescargando(false); }
  }

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / 50)) : 1;

  return (
    <div className="px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111418]">Bitácora</h1>
          <p className="text-[13px] text-[#26302B] mt-1">{datos ? `${datos.total.toLocaleString("es-EC")} cambio${datos.total === 1 ? "" : "s"} en el período` : "Cargando…"}</p>
        </div>
        <button type="button" className={claseBoton} disabled={descargando || !datos?.total} onClick={descargar}>
          {descargando ? "Generando…" : "Descargar Excel"}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-[#26302B]">Desde</span>
          <input type="date" className={claseInput} value={desde} max={hasta} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-[#26302B]">Hasta</span>
          <input type="date" className={claseInput} value={hasta} min={desde} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-[#26302B]">Usuario</span>
          <input className={claseInput} value={usuario} placeholder="todos" onChange={(e) => { setUsuario(e.target.value); setPagina(1); }} /></label>
      </div>

      {error && <p role="alert" className="mb-4 text-[13px] text-[#9B1C1C]">{error}</p>}
      {aviso && <p role="status" className="mb-4 text-[13px] text-[#0B5A2A]">{aviso}</p>}

      <div className="bg-white rounded-2xl border border-[#E3E6E4] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[900px]">
          <thead>
            <tr className="text-left text-[11px] font-bold tracking-[0.04em] text-[#26302B] border-b border-[#E3E6E4]">
              <th className="px-5 py-3 whitespace-nowrap">FECHA Y HORA</th>
              <th className="px-3 py-3">USUARIO</th>
              <th className="px-3 py-3">ACCIÓN</th>
              <th className="px-3 py-3">PANTALLA</th>
              <th className="px-3 py-3">AGENCIA</th>
              <th className="px-3 py-3">DETALLE</th>
              <th className="px-5 py-3 text-right">COPIA</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.filas ?? []).map((f) => (
              <tr key={f.id} className="border-b border-[#EEF1EF] last:border-0">
                <td className="px-5 py-2.5 whitespace-nowrap text-[#4A554F]">{fechaLocal(f.fecha)}</td>
                <td className="px-3 py-2.5">{f.usuario}</td>
                <td className="px-3 py-2.5">{f.accion}</td>
                <td className="px-3 py-2.5">{f.pantalla}</td>
                <td className="px-3 py-2.5">{f.agencia ?? "—"}</td>
                <td className="px-3 py-2.5 text-[#26302B]">{f.detalle}</td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  {f.instantanea_id && (f.restaurada_en
                    ? <span className="text-[11px] text-[#6B7570]" title={`Por ${f.restaurada_por ?? "—"}`}>Restaurada {fechaLocal(f.restaurada_en)}</span>
                    : <button type="button" className={claseBoton} disabled={restaurando !== null} onClick={() => restaurar(f)}>{restaurando === f.id ? "Restaurando…" : "Restaurar"}</button>)}
                </td>
              </tr>
            ))}
            {datos && datos.filas.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-6 text-[#6B7570]">Sin cambios registrados en el período.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-[12px] text-[#26302B]">
          <button type="button" className={claseBoton} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span>Página {pagina} de {paginas}</span>
          <button type="button" className={claseBoton} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}
