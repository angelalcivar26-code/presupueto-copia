"use client";
import { useEffect, useState } from "react";
import { cargarJSON } from "./useDatos";
import { AGENCIAS } from "../components/EgresosComun";
import { baseDe, type Base } from "./calc/indicadores-presupuesto";

/**
 * Balance general y estado de resultados proyectados de las 10 agencias (de a dos, con la memoria del servidor),
 * convertidos en la base de indicadores. Lo usan Indicadores del presupuesto y Planificación → Análisis de agencia.
 */
type Respuesta = { activo?: unknown; pasivo?: unknown; patrimonio?: unknown; ingresos?: unknown; egresos?: unknown; error?: string };
export function useBasesPresupuesto(ejercicio: number, activo = true) {
  const [bases, setBases] = useState<Record<string, Base>>({});
  const [errores, setErrores] = useState<string[]>([]);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const cola = [...AGENCIAS];
    const una = async (ag: string) => {
      const q = `agencia=${encodeURIComponent(ag)}&ejercicio=${ejercicio}`;
      let bal: Respuesta | null = null, er: Respuesta | null = null;
      await Promise.all([
        cargarJSON<Respuesta>(`/api/balance-general?${q}`, (d) => { bal = d; }),
        cargarJSON<Respuesta>(`/api/estado-resultados?${q}`, (d) => { er = d; }),
      ]).catch(() => undefined);
      if (!vivo) return;
      const b = bal as Respuesta | null, e = er as Respuesta | null;
      if (b?.activo && e?.ingresos) setBases((x) => ({ ...x, [ag]: baseDe(b as never, e as never) }));
      else setErrores((x) => [...x, ag]);
    };
    const trabajador = async () => { while (vivo && cola.length) await una(cola.shift()!); };
    Promise.all([trabajador(), trabajador()]);
    return () => { vivo = false; };
  }, [ejercicio, activo]);
  return { bases, errores, listas: Object.keys(bases).length, completo: Object.keys(bases).length + errores.length >= AGENCIAS.length };
}
