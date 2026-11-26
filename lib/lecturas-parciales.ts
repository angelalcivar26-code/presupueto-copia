import { AsyncLocalStorage } from "node:async_hooks";

/**
 * LECTURAS QUE FALLARON DURANTE UN CÁLCULO.
 *
 * Cuando una lectura secundaria falla (inversiones, diferidos, provisión…), el motor sigue con un
 * cálculo alterno. Antes eso pasaba en silencio y el resultado alterno se guardaba para todos.
 * Ahora cada falla se anota aquí: la respuesta no se guarda en la memoria compartida y la pantalla
 * muestra un aviso. No consulta la base.
 */
const almacen = new AsyncLocalStorage<{ fallidas: string[] }>();

/** Ejecuta `fn` anotando las lecturas que fallen dentro de ella. */
export function conRegistroLecturas<T>(fn: () => Promise<T>): Promise<{ valor: T; fallidas: string[] }> {
  const estado = { fallidas: [] as string[] };
  return almacen.run(estado, async () => ({ valor: await fn(), fallidas: estado.fallidas }));
}

/** Anota una lectura fallida en el pedido en curso (si lo hay). */
export function registrarLecturasFallidas(mensajes: string[]) {
  const e = almacen.getStore();
  if (!e) return;
  for (const m of mensajes) if (!e.fallidas.includes(m)) e.fallidas.push(m);
}

/** Cabecera con la que viaja el aviso hasta la pantalla. */
export const CABECERA_LECTURA_PARCIAL = "x-lectura-parcial";
