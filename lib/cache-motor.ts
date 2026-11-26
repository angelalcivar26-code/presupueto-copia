import { versionReciente } from "./turso";
import { conRegistroLecturas, CABECERA_LECTURA_PARCIAL } from "./lecturas-parciales";
import { leerGuardado, guardarResultado, limpiarOtrasVersiones, type RespuestaGuardada } from "./cache-persistente";
import { conVentana, sufijoVentana, ventanaDeTexto } from "./ventana-simulada";

/**
 * Memoria temporal del servidor para resultados pesados (insumos del motor).
 *
 * Cada resultado se guarda junto con el numero de version de los datos
 * (tabla datos_version, ver lib/turso.ts). Se reutiliza solo si ese numero no
 * cambio; cualquier escritura en la base lo sube y el siguiente pedido vuelve
 * a calcular. Dos pedidos iguales al mismo tiempo comparten un solo calculo.
 * Si no se puede leer la version, se calcula sin memoria (nunca datos viejos).
 */
interface Entrada { version: number; valor: Promise<unknown> }
const memoria = new Map<string, Entrada>();

export async function conCache<T>(claveBase: string, calcular: (version?: number) => Promise<T>): Promise<T> {
  const clave = claveBase + sufijoVentana();
  let version: number;
  try {
    version = await versionReciente();
  } catch (e) {
    console.error("[cache] no se pudo leer la version de los datos, se calcula sin memoria", e);
    return calcular();
  }

  const guardado = memoria.get(clave);
  if (guardado && guardado.version === version) return guardado.valor as Promise<T>;

  const valor = calcular(version);
  memoria.set(clave, { version, valor });
  // Si el calculo falla, no se guarda el error
  valor.catch(() => { if (memoria.get(clave)?.valor === valor) memoria.delete(clave); });
  // Se descarta lo calculado con versiones anteriores
  for (const [k, e] of memoria) if (e.version !== version) memoria.delete(k);
  return valor;
}

/** Descarta lo guardado en memoria para una clave (p. ej. un cálculo hecho con una lectura fallida). */
export function olvidarCache(clave: string) {
  memoria.delete(clave + sufijoVentana());
}

/**
 * Envuelve el GET de una ruta pesada. Orden de búsqueda, siempre con la misma versión de datos:
 *   1) memoria de este servidor (instantáneo);
 *   2) resultado guardado en Turso por cualquier servidor (1 fila; sobrevive reinicios y se comparte
 *      entre usuarios y servidores);
 *   3) se calcula, se responde y se guarda en Turso para los siguientes.
 * Los errores no se guardan.
 */
// Versión del programa: cada despliegue nuevo usa claves nuevas, así un resultado guardado
// por la versión anterior (con otro cálculo u otros campos) nunca se vuelve a servir.
const VERSION_PROGRAMA = (process.env.VERSION_BUILD || process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 12);

export function conCacheGET(nombre: string, handler: (req: import("next/server").NextRequest) => Promise<Response>) {
  // ?ventana=AAAA-MM_AAAA-MM: se calcula con esa base simulada (solo lectura; la clave ya la incluye)
  return async (req: import("next/server").NextRequest): Promise<Response> =>
    conVentana(ventanaDeTexto(req.nextUrl.searchParams.get("ventana")), () => leerConCache(nombre, handler, req));
}

async function leerConCache(nombre: string, handler: (req: import("next/server").NextRequest) => Promise<Response>, req: import("next/server").NextRequest): Promise<Response> {
    const clave = `ruta:${VERSION_PROGRAMA}:${nombre}:${req.nextUrl.searchParams.toString()}`;
    try {
      const r = await conCache<RespuestaGuardada>(clave, async (version) => {
        if (version !== undefined) {
          const previo = await leerGuardado(clave, version).catch(() => null);
          if (previo) return previo;
        }
        const { valor: res, fallidas } = await conRegistroLecturas(() => handler(req));
        const guardado: RespuestaGuardada = { status: res.status, body: await res.text(), tipo: res.headers.get("content-type") ?? "application/json" };
        if (res.status >= 500) throw Object.assign(new Error("respuesta 5xx"), { respuesta: guardado });
        if (fallidas.length) {
          // Calculado con un método alterno: se responde con aviso, pero no se guarda ni se reutiliza.
          return { ...guardado, parcial: fallidas } as RespuestaGuardada;
        }
        if (version !== undefined && res.status < 300) {
          guardarResultado(clave, version, guardado).catch((e) => console.error("[cache] no se pudo guardar el resultado", e));
          limpiarOtrasVersiones(`ruta:${VERSION_PROGRAMA}:`).catch(() => undefined);
        }
        return guardado;
      });
      const parcial = (r as RespuestaGuardada & { parcial?: string[] }).parcial;
      if (parcial) {
        olvidarCache(clave);
        return new Response(r.body, { status: r.status, headers: { "content-type": r.tipo, [CABECERA_LECTURA_PARCIAL]: encodeURIComponent(parcial.join(" · ")) } });
      }
      return new Response(r.body, { status: r.status, headers: { "content-type": r.tipo } });
    } catch (e) {
      const r = (e as { respuesta?: RespuestaGuardada }).respuesta;
      if (r) return new Response(r.body, { status: r.status, headers: { "content-type": r.tipo } });
      throw e;
    }
}