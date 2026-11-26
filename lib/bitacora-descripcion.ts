/**
 * Textos de la bitácora: nombre de la pantalla (por su dirección) y de lo que se guardó (por la ruta).
 * Sin acceso a la base: lo usa el middleware.
 */
const PANTALLAS: Record<string, string> = {
  "/inicio": "Inicio", "/balance-general": "Balance general", "/estado-resultados": "Estado de resultados",
  "/flujo-efectivo": "Flujo de efectivo", "/indicadores": "Indicadores", "/planificacion": "Planificación",
  "/fondos-disponibles": "Fondos disponibles", "/inversiones": "Inversiones", "/cartera": "Cartera de crédito",
  "/cuentas-por-cobrar": "Cuentas por cobrar", "/activos-fijos": "Activos fijos", "/otros-activos": "Otros activos",
  "/captaciones": "Obligaciones con el público", "/cuentas-por-pagar": "Cuentas por pagar",
  "/obligaciones-financieras": "Obligaciones financieras", "/otros-pasivos": "Otros pasivos", "/patrimonio": "Patrimonio",
  "/proyeccion-ingresos": "Proyección de ingresos", "/intereses-causados": "Intereses causados", "/provisiones": "Provisiones",
  "/proyeccion-egresos": "Gastos operacionales", "/otros-gastos": "Otros gastos", "/carga-datos": "Carga de datos",
  "/catalogo-cuentas": "Catálogo de cuentas", "/administracion/usuarios": "Usuarios", "/administracion/bitacora": "Bitácora", "/administracion/parametros": "Parámetros institucionales",
};

const RUTAS: Record<string, string> = {
  "activos-diferidos": "Gastos anticipados y diferidos", "activos-fijos": "Activos fijos", "activos-fijos-bienes": "Registro de bienes",
  "activos-fijos-compras": "Compras de activos fijos", "activos-fijos-registro": "Registro de activos fijos",
  "base-historica-gastos": "Base histórica de gastos", "catalogo-cuentas": "Catálogo de cuentas", "ejercicios": "Ejercicio",
  "estudio-agencia": "Estudio de agencia", "estudio-borradores": "Borrador de estudio", "factores-depreciacion": "Factores de depreciación",
  "historico": "Históricos", "hojas-presupuesto": "Hoja de presupuesto", "inversiones": "Inversiones", "materiales-plan": "Plan de materiales",
  "metas-credito-institucional": "Metas de crédito", "nomina-empleados": "Nómina", "notas-reporte": "Notas del reporte",
  "oficiales-credito": "Oficiales de crédito", "otros-pasivo-parametros": "Parámetros", "parametros-captaciones": "Parámetros de captaciones",
  "parametros-credito": "Parámetros de crédito", "parametros-fondos": "Parámetros de fondos disponibles",
  "parametros-produccion": "Parámetros de producción", "parametros-provision": "Parámetros de provisión",
  "porcentajes-activo": "Porcentajes de activo", "prestamos-internos": "Préstamos internos",
  "presupuesto-departamental": "Montos de cuenta", "presupuesto-resumen": "Valor institucional",
  "provision-flow-parametros": "Modelo de provisión", "provision-real": "Provisión real", "recuperacion-cartera": "Recuperación de cartera",
  "resumen-4501": "Resumen 4501", "saldos-iniciales": "Saldos iniciales (balance)", "transferencias-internas": "Transferencias internas",
  "usuarios": "Usuarios", "planificacion": "Planificación", "instantaneas": "Copia restaurada", "parametros-institucionales": "Parámetros institucionales",
};

const ACCION: Record<string, string> = { POST: "Guardó", PUT: "Guardó", PATCH: "Modificó", DELETE: "Eliminó" };

export function pantallaDe(referer: string | null): string {
  if (!referer) return "—";
  try {
    const p = new URL(referer).pathname.replace(/\/$/, "") || "/";
    return PANTALLAS[p] ?? p;
  } catch { return "—"; }
}

/** Acción y detalle a partir del método, la ruta y lo enviado. */
export function describir(metodo: string, pathname: string, consulta: URLSearchParams, cuerpo: Record<string, unknown> | null) {
  const ruta = pathname.replace(/^\/api\//, "").split("/")[0];
  const v = (k: string) => {
    const x = cuerpo?.[k] ?? consulta.get(k);
    return x === null || x === undefined || x === "" || typeof x === "object" ? null : String(x);
  };
  const accionCuerpo = v("accion");
  const accion = ruta === "instantaneas" ? "Restauró"
    : (ruta === "saldos-iniciales" || ruta === "historico") && metodo !== "DELETE" ? "Cargó" : ACCION[metodo] ?? metodo;
  const partes = [RUTAS[ruta] ?? ruta];
  for (const k of ["concepto", "codigo", "departamento", "nombre", "descripcion", "hoja", "oficina", "periodo"]) {
    const x = v(k);
    if (x && !partes.includes(x)) partes.push(x);
  }
  if (accionCuerpo) partes.push(`(${accionCuerpo.replace(/_/g, " ")})`);
  const anio = v("anio"), mes = v("mes");
  if (ruta === "saldos-iniciales" && anio && mes) partes.push(`corte ${mes}/${anio}`);
  const ej = Number(v("ejercicio"));
  return {
    accion, detalle: partes.join(" · "),
    agencia: v("agencia"), ejercicio: Number.isFinite(ej) && ej > 2000 ? ej : null,
  };
}
