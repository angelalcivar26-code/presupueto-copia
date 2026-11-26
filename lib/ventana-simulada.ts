import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Base de calibración simulada (solo lectura): permite calcular el presupuesto con otra ventana de meses
 * sin guardarla. La usa el panel "Actualizar la base" para comparar bases (jul–oct, jul–dic, …) lado a lado.
 * Mientras está activa, leerConfig() devuelve esa ventana y cada resultado en memoria lleva su propia clave.
 */
export interface Ventana { desde: string; hasta: string }

const almacen = new AsyncLocalStorage<Ventana>();
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ?ventana=AAAA-MM_AAAA-MM → ventana válida o null. */
export function ventanaDeTexto(t: string | null | undefined): Ventana | null {
  if (!t) return null;
  const [desde, hasta] = t.split("_");
  return MES.test(desde ?? "") && MES.test(hasta ?? "") && desde <= hasta ? { desde, hasta } : null;
}

export function ventanaSimulada(): Ventana | null {
  return almacen.getStore() ?? null;
}

export function conVentana<T>(v: Ventana | null, f: () => T): T {
  return v ? almacen.run(v, f) : f();
}

/** Sufijo para claves de memoria: lo calculado con una base simulada nunca se mezcla con lo de la base guardada. */
export function sufijoVentana(): string {
  const v = almacen.getStore();
  return v ? `|base:${v.desde}_${v.hasta}` : "";
}
