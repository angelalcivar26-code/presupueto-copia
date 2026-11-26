"use client";
/**
 * CARGA DE DATOS → Activos diferidos: reporte de contabilidad «Amortización de activos diferidos» (gastos diferidos,
 * 1905). Es el único lugar donde se sube; Otros activos → Gastos diferidos usa estas partidas (y las registradas a mano).
 * Uno o varios archivos (o .zip): la agencia sale de la columna OFICINA de cada partida.
 */
import { useEffect, useState } from "react";
import ZonaArchivos from "./ZonaArchivos";
import { apiFetch } from "../lib/useDatos";
import { notificarCambioArchivo } from "../lib/cache-sistema";
import { useEjercicio } from "../lib/seleccion";
import { C, Tarjeta, usd, etiquetaCorte } from "./ActivosComun";
import { VistaArchivo } from "./ActivosDiferidos";
import { leerArchivoDiferidos, NOMBRE_CUENTA_1905, type LecturaArchivo } from "../lib/calc/diferidos-archivo";
import { matrizDe, mensajeOtraPestana } from "../lib/detectar-archivo";

interface Base { fechaCorte: string; corte: { anio: number; mes: number }; cuentas: { codigo: string; nombre: string }[] }
interface Cargado { agencia: string; partidas: number; monto: number; actualizado: string }

export function CargaDiferidos() {
  const [ejercicio] = useEjercicio();
  const [base, setBase] = useState<Base | null>(null);
  const [cargados, setCargados] = useState<Cargado[]>([]);
  const [version, setVersion] = useState(0);
  const [archivo, setArchivo] = useState<{ nombre: string; lectura: LecturaArchivo } | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<{ t: string; e?: boolean } | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      apiFetch(`/api/activos-diferidos?agencia=Matriz&ejercicio=${ejercicio}`).then((r) => r.json()),
      apiFetch(`/api/activos-diferidos?vista=cargados&ejercicio=${ejercicio}`).then((r) => r.json()),
    ]).then(([b, c]) => {
      if (!vivo) return;
      if (b.error) setAviso({ t: b.error, e: true }); else setBase({ fechaCorte: b.fechaCorte, corte: b.corte, cuentas: b.cuentas ?? [] });
      setCargados(c.cargados ?? []);
    }).catch(() => { if (vivo) setAviso({ t: "No hay conexión con el servidor.", e: true }); });
    return () => { vivo = false; };
  }, [ejercicio, version]);

  async function leer(lista: File[]) {
    if (!base) return;
    setAviso(null);
    const errs: string[] = [];
    let junta: { nombres: string[]; lectura: LecturaArchivo } | null = null;
    for (const f of lista) {
      let datos: ArrayBuffer | null = null;
      try {
        datos = await f.arrayBuffer();
        const l = leerArchivoDiferidos(matrizDe(datos, true), base.fechaCorte, base.cuentas);
        if (l.faltan.length) { errs.push(mensajeOtraPestana(f.name, datos, "Activos diferidos", `no se encontraron las columnas ${l.faltan.join(", ")}.`)); continue; }
        if (!junta) { junta = { nombres: [f.name], lectura: l }; continue; }
        // otro archivo: se junta solo si trae otras agencias (cada carga reemplaza las partidas de sus agencias)
        const ya = new Set(junta.lectura.filas.map((x) => x.agencia));
        const repetidas = [...new Set(l.filas.map((x) => x.agencia))].filter((a) => ya.has(a));
        if (repetidas.length) { errs.push(`${f.name}: ${repetidas.join(", ")} ya vienen en ${junta.nombres.join(", ")}; no se toma dos veces.`); continue; }
        const a: LecturaArchivo = junta.lectura;
        junta = { nombres: [...junta.nombres, f.name], lectura: {
          filas: [...a.filas, ...l.filas], omitidas: a.omitidas + l.omitidas, faltan: [],
          sinAgencia: [...new Set([...a.sinAgencia, ...l.sinAgencia])], sinCuenta: [...new Set([...a.sinCuenta, ...l.sinCuenta])],
          columnas: a.columnas, ignoradas: a.ignoradas,
        } };
      } catch (e) { errs.push(datos ? mensajeOtraPestana(f.name, datos, "Activos diferidos", e instanceof Error ? e.message : "no se pudo leer.") : `${f.name}: no se pudo leer.`); }
    }
    setErrores(errs);
    setArchivo(junta ? { nombre: junta.nombres.join(", "), lectura: junta.lectura } : null);
  }

  async function cargar() {
    if (!archivo) return;
    setSubiendo(true); setAviso(null);
    try {
      const r = await apiFetch("/api/activos-diferidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "importar", grupo: "1905", filas: archivo.lectura.filas }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
      setAviso({ t: `Cargadas ${j.partidas} partidas de ${j.agencias} ${j.agencias === 1 ? "agencia" : "agencias"}.${j.conservadas ? ` Se conservó lo editado en ${j.conservadas}.` : ""}` });
      notificarCambioArchivo("subida", `Activos diferidos (${j.partidas} partidas)`);
      setArchivo(null); setErrores([]); setVersion((v) => v + 1);
    } catch (e) { setAviso({ t: `No se pudo cargar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setSubiendo(false); }
  }

  const nombre = (cod: string) => base?.cuentas.find((c) => c.codigo === cod)?.nombre ?? NOMBRE_CUENTA_1905[cod] ?? cod;
  const total = cargados.reduce((t, c) => ({ p: t.p + c.partidas, m: t.m + c.monto }), { p: 0, m: 0 });
  return (
    <div className="flex flex-col gap-5 pb-6">
      {aviso && <p className="text-[12px] -my-2" style={{ color: aviso.e ? C.alerta : C.ok }}>{aviso.t}</p>}
      <Tarjeta titulo={`Amortización de activos diferidos · presupuesto ${ejercicio}${base ? ` · corte ${etiquetaCorte(base.corte)}` : ""}`}>
        <div className="p-4 flex flex-col gap-3">
          {archivo ? (
            <VistaArchivo archivo={archivo} corte={base ? etiquetaCorte(base.corte) : ""} nombre={nombre} subiendo={subiendo}
              onCancelar={() => { setArchivo(null); setErrores([]); }} onCargar={cargar} />
          ) : <ZonaArchivos texto="Subir reporte de amortización de activos diferidos" onArchivos={leer} deshabilitada={!base} />}
          {errores.length > 0 && (
            <ul className="text-[12px] flex flex-col gap-0.5" style={{ color: C.alerta }}>
              {errores.slice(0, 20).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Partidas cargadas del reporte (${total.p})`}>
        {cargados.length === 0 ? <p className="px-4 py-3 text-[12px]" style={{ color: C.texto2 }}>Sin datos.</p> : (
          <table className="w-full text-[12px] border-collapse">
            <thead><tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
              <th className="pl-4 text-left font-semibold">Agencia</th><th className="px-3 text-right font-semibold">Partidas</th>
              <th className="px-3 text-right font-semibold">Valor a amortizar</th><th className="pr-4 text-right font-semibold">Cargado</th>
            </tr></thead>
            <tbody>
              {cargados.sort((a, b) => b.monto - a.monto).map((c) => (
                <tr key={c.agencia} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4" style={{ color: C.texto }}>{c.agencia}</td>
                  <td className="px-3 text-right" style={{ color: C.texto3 }}>{c.partidas}</td>
                  <td className="px-3 text-right" style={{ color: C.texto3 }}>{usd(c.monto)}</td>
                  <td className="pr-4 text-right" style={{ color: C.texto2 }}>{c.actualizado ? new Date(c.actualizado.replace(" ", "T") + "Z").toLocaleDateString("es-EC") : "—"}</td>
                </tr>
              ))}
              <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 32 }}>
                <td className="pl-4">Total</td><td className="px-3 text-right">{total.p}</td><td className="px-3 text-right">{usd(total.m)}</td><td />
              </tr>
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}
