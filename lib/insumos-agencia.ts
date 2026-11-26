import { getDb } from "./turso";
import { leerParametrosInstitucionales } from "./parametros-institucionales";
import { adjuntarParametrosVigentes, parametrosVigentesDe, type ParametrosVigentes } from "./calc/parametros-vigentes";
import { ejercicioDelPedido } from "./ejercicio-pedido";
import { conCache, olvidarCache } from "./cache-motor";
import { registrarLecturasFallidas } from "./lecturas-parciales";
import { getOrCreateMatrizId } from "./agencias";
import type {
  FilaParametroCaptaciones,
  FilaParametroCredito,
  FilaPresupuestoDepartamental,
  FilaEmpleadoNomina,
  SaldosPorCodigo,
  FilaOficialCredito,
  MetasCreditoInstitucional,
  FactoresDepreciacion,
  FilaParametroOtrosPasivo,
} from "./calc/orquestador";
import {
  adjuntarDepreciacionRegistro,
  depreciacionRegistroPorCategoria,
  type BienRegistroActivoFijo,
} from "./calc/activo-fijo";
import { adjuntarParametrosProvision } from "./calc/provision";
import { historicoProvision, leerParametrosProvision, pctActualDe, resolverParametrosMotor } from "./parametros-provision";
import { adjuntarInversiones, inversionesDe, proyectarInversiones } from "./calc/inversiones";
import { adjuntarParametrosFondos } from "./calc/fondos";
import { adjuntarProvisionFlow } from "./calc/provision-flow";
import { leerReferenciaCartera } from "./referencia-cartera-db";
import { leerInsumosProvisionFlow } from "./provision-flow-db";
import { leerParametrosFondosAgencia } from "./parametros-fondos";
import { leerInversiones } from "./inversiones";
import { leerDiferidos, nombresCuentasGasto, planMaterialesAgencia } from "./activos-diferidos";
import { proyectarDiferidos, adjuntarDiferidos, diferidosDe, agregarPlanMateriales, CONCEPTO_ANTICIPOS } from "./calc/activos-diferidos";
import { adjuntarRendimientoFL, proyectarRendimientoFL, CONCEPTO_RENDIMIENTO_FL } from "./calc/otros-activos";
import { leerContribucionesReales } from "./contribuciones-db";
import { asegurarColumnasCredito } from "./parametros-credito-db";
import { adjuntarContribuciones } from "./calc/contribuciones";
import { prestamosDeAgencia } from "./prestamos-internos";
import { adjuntarPrestamosInternos } from "./calc/prestamos-internos";
import { calcularBalanceGeneralMatriz, interesMoraDe, CONCEPTO_INTERES_MORA, RELACION_MORA_INTERES_NORMAL, type NodoBalance } from "./calc/orquestador";
import { interesMoraRealAgencia } from "./interes-mora-db";
import {
  adjuntarIngresos51, detectarPrestamosInternos, interesSobreSaldoAnterior, saldoCuenta, tasaMensual, verificar, TASA_PRESTAMOS_INTERNOS,
} from "./calc/ingresos-51";

/**
 * Fuente única de las 9 consultas que TODOS los endpoints de reportes
 * (balance-general, estado-resultados, flujo-efectivo, ingresos-cartera-detalle,
 * otros-activos-detalle, pasivo-detalle, patrimonio-detalle, cartera-credito,
 * etc.) necesitan para poder llamar a cualquier función de orquestador.ts.
 *
 * Antes cada route.ts copiaba y pegaba estas mismas 9 consultas -- lo que
 * significaba que agregar una columna nueva a una tabla de parámetros
 * institucionales (como pasó con "relacion_mora" en metas_credito_institucional)
 * había que recordarlo en cada archivo por separado, y era facilísimo dejar
 * alguno atrás. Ahora se cambia UNA sola vez, aquí, y automáticamente todos
 * los endpoints que llaman a cargarInsumosAgencia() lo reciben.
 */

export async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

/**
 * Corte de saldos iniciales que usa el motor para una agencia: el MÁS
 * RECIENTE que se haya cargado por Carga de datos (tabla saldos_cargas).
 * Así, al subir el balance de agosto 2026 la herramienta pasa a usarlo sola,
 * y al subir diciembre 2026 pasa a ese, sin tocar código ni borrar los
 * anteriores. Si la agencia no tiene ninguna carga registrada, se usa
 * dic-2025 (comportamiento anterior).
 */
export async function resolverCorteSaldos(
  db: ReturnType<typeof getDb>,
  agenciaId: number,
  ejercicio?: number | null
): Promise<{ anio: number; mes: number }> {
  // Balance de partida del ejercicio: el último corte anterior a su enero (el 2027 usa el de 2026,
  // el 2028 el de 2027). Si no hay ninguno anterior, el más reciente cargado.
  const ej = ejercicio ?? (await ejercicioDelPedido());
  const res = await db.execute({
    sql: `SELECT anio, mes FROM saldos_cargas WHERE agencia_id = ?
          ORDER BY CASE WHEN ? IS NULL OR anio < ? THEN 0 ELSE 1 END, anio DESC, mes DESC LIMIT 1`,
    args: [agenciaId, ej, ej],
  });
  const r = res.rows[0];
  return r ? { anio: Number(r.anio), mes: Number(r.mes) } : { anio: 2025, mes: 12 };
}

interface InsumosAgencia {
  saldos: SaldosPorCodigo;
  paramsCaptaciones: FilaParametroCaptaciones[];
  paramsCredito: FilaParametroCredito[];
  filasPresupuesto: FilaPresupuestoDepartamental[];
  empleados: FilaEmpleadoNomina[];
  oficialesCredito: FilaOficialCredito[];
  metasCredito: MetasCreditoInstitucional;
  factoresDepreciacion: FactoresDepreciacion;
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[];
  /** Corte de saldos iniciales usado (el más reciente cargado). */
  corteSaldos: { anio: number; mes: number };
  /** Resultado del año en curso llevado a 36 por el cierre simulado (0 en diciembre). */
  ajusteCierre: number;
  /** Lecturas que fallaron (el cálculo siguió con un método alterno): se avisa y no se guarda el resultado. */
  lecturasFallidas: string[];
  /** De dónde sale el % de interés de mora: escrito en Planificación, automático (real de sus ER) o el institucional. */
  interesMora: { origen: "manual" | "automatico" | "institucional"; valor: number; desde?: string; hasta?: string };
  /** Registro de activos fijos usado (null si la agencia no lo tiene cargado). */
  registroActivosFijos: { fechaCorte: string; bienes: number } | null;
}

/**
 * Registro de activos fijos bien por bien (tabla activos_fijos): toma el
 * corte MÁS RECIENTE cargado para esa agencia y ejercicio. Si la tabla no
 * existe todavía o la agencia no tiene registro, devuelve null y el motor
 * sigue con el cálculo anterior.
 */
export async function cargarRegistroActivosFijos(
  db: ReturnType<typeof getDb>,
  agenciaId: number,
  ejercicio: number
): Promise<{ fechaCorte: string; bienes: BienRegistroActivoFijo[] } | null> {
  try {
    const corteRes = await db.execute({
      sql: `SELECT MAX(fecha_corte) AS fecha FROM activos_fijos WHERE agencia_id = ? AND ejercicio = ?`,
      args: [agenciaId, ejercicio],
    });
    const fechaCorte = corteRes.rows[0]?.fecha as string | null;
    if (!fechaCorte) return null;
    const res = await db.execute({
      sql: `SELECT categoria, valor_contable, valor_historico, valor_residual, vida_util_meses, dep_acumulada, dep_mensual
            FROM activos_fijos WHERE agencia_id = ? AND ejercicio = ? AND fecha_corte = ?`,
      args: [agenciaId, ejercicio, fechaCorte],
    });
    const bienes: BienRegistroActivoFijo[] = res.rows.map((r) => ({
      categoria: r.categoria as string,
      valor_contable: Number(r.valor_contable) || 0,
      valor_historico: Number(r.valor_historico) || 0,
      valor_residual: Number(r.valor_residual) || 0,
      vida_util_meses: Number(r.vida_util_meses) || 0,
      dep_acumulada: Number(r.dep_acumulada) || 0,
      dep_mensual: Number(r.dep_mensual) || 0,
    }));
    return { fechaCorte, bienes };
  } catch {
    // La tabla activos_fijos se crea con la primera carga; antes de eso no existe.
    return null;
  }
}

type ResultadoInsumosAgencia = { ok: true; insumos: InsumosAgencia } | { ok: false; error: string };

/**
 * Insumos del motor para una agencia. Es lo más pesado de la herramienta (~15 consultas y
 * 3 vueltas del motor para la 5101), así que se guarda en la memoria temporal del servidor
 * (lib/cache-motor.ts) y se reutiliza mientras no cambie ningún dato en la base. Cada llamada
 * recibe sus propias listas (copias), así que un endpoint no puede alterar lo que ve el siguiente.
 */
export async function cargarInsumosAgencia(agenciaNombre: string, ejercicio: number): Promise<ResultadoInsumosAgencia> {
  const clave = `insumos:${agenciaNombre}:${ejercicio}`;
  const r = await conCache(clave, () => calcularInsumosAgencia(agenciaNombre, ejercicio));
  if (!r.ok) return r;
  const i = r.insumos;
  if (i.lecturasFallidas.length) {
    // Un cálculo alterno por una falla momentánea no se reutiliza: el siguiente pedido vuelve a leer.
    olvidarCache(clave);
    registrarLecturasFallidas(i.lecturasFallidas.map((m) => `${agenciaNombre}: ${m}`));
  }
  return {
    ok: true,
    insumos: {
      ...i,
      paramsCaptaciones: [...i.paramsCaptaciones],
      paramsCredito: [...i.paramsCredito],
      filasPresupuesto: [...i.filasPresupuesto],
      empleados: (() => { const e = [...i.empleados]; adjuntarParametrosVigentes(e, parametrosVigentesDe(i.empleados)); return e; })(),
      oficialesCredito: [...i.oficialesCredito],
      parametrosOtrosPasivo: [...i.parametrosOtrosPasivo],
      corteSaldos: { ...i.corteSaldos },
    },
  };
}

async function calcularInsumosAgencia(agenciaNombre: string, ejercicio: number): Promise<ResultadoInsumosAgencia> {
  const db = getDb();
  const agenciaId = await resolverAgenciaId(db, agenciaNombre);
  const corteSaldos = await resolverCorteSaldos(db, agenciaId, ejercicio);
  const lecturasFallidas: string[] = [];
  const fallo = (que: string, e: unknown) => { console.error(`[insumos] ${que}`, e); lecturasFallidas.push(que); };

  // Lecturas independientes que antes iban una tras otra: se lanzan todas a la vez.
  const provisionPrevia = (async () => {
    const historico = await historicoProvision(db, agenciaId, agenciaNombre);
    const pctActual = pctActualDe(historico, corteSaldos);
    const guardados = await leerParametrosProvision(db, agenciaId, pctActual);
    return resolverParametrosMotor(guardados, pctActual);
  })();
  provisionPrevia.catch(() => undefined);
  const registroPrevio = cargarRegistroActivosFijos(db, agenciaId, ejercicio);
  const inversionesPrevias = leerInversiones(db, agenciaId);
  inversionesPrevias.catch(() => undefined);
  const diferidosPrevios = leerDiferidos(db, agenciaId, agenciaNombre);
  diferidosPrevios.catch(() => undefined);
  const fondosPrevios = leerParametrosFondosAgencia(db, agenciaId);
  fondosPrevios.catch(() => undefined);
  const provisionFlowPrevia = leerInsumosProvisionFlow(db, agenciaNombre, ejercicio);
  provisionFlowPrevia.catch(() => undefined);
  const catalogo1908Previo = db
    .execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo LIKE '1908%' OR codigo LIKE '2908%'`)
    .catch((e) => { fallo("no se pudo leer el catálogo de préstamos internos (1908/2908)", e); return { rows: [] as Record<string, unknown>[] }; });

  await asegurarColumnasCredito(db);
  const [saldosRes, captacionesRes, creditoRes, presupuestoRes, nominaRes, oficialesRes, metasRes, factoresRes, otrosPasivoRes] = await Promise.all([
    db.execute({ sql: `SELECT cuenta_codigo, monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agenciaId, corteSaldos.anio, corteSaldos.mes] }),
    db.execute({
      sql: `SELECT producto, mes, tasa_interes_anual, pct_ingresos, pct_retiros, pct_cancelaciones, ratio_renovaciones, pct_liquidez
            FROM parametros_captaciones WHERE agencia_id = ?`,
      args: [agenciaId],
    }),
    db.execute({
      sql: `SELECT linea, mes, monto_promedio, tasa_interes_anual, pct_recuperacion_periodo,
                   tasa_efectividad_recup, num_operaciones_conceder, tasa_recuperacion_vencida, pct_distribucion,
                   pct_pase_riesgo, pct_precancelacion, pct_precancelacion_vencida
            FROM parametros_credito WHERE agencia_id = ?`,
      args: [agenciaId],
    }),
    db.execute({
      sql: `SELECT departamento, concepto, cuenta_nombre, mes, monto FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ?`,
      args: [agenciaId, ejercicio],
    }),
    db.execute({
      sql: `SELECT nombre, basico_2025, incremento_pct, movilizacion_anual
            FROM nomina_empleados WHERE agencia_id = ? AND activo = 1`,
      args: [agenciaId],
    }),
    db.execute({
      sql: `SELECT rango, activo FROM oficiales_credito WHERE agencia_id = ?`,
      args: [agenciaId],
    }),
    db.execute({
      sql: `SELECT meta_junior, meta_senior, meta_master, minimo_operaciones, relacion_mora FROM metas_credito_institucional WHERE id = 1`,
    }),
    db.execute({ sql: `SELECT categoria, factor_anual FROM factores_depreciacion` }),
    db.execute({
      sql: `SELECT concepto, mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ?`,
      args: [agenciaId, ejercicio],
    }),
  ]);

  const saldos: SaldosPorCodigo = {};
  for (const row of saldosRes.rows) saldos[row.cuenta_codigo as string] = row.monto as number;

  if (Object.keys(saldos).length === 0) {
    return { ok: false, error: `No hay saldos iniciales cargados para ${agenciaNombre} (corte ${corteSaldos.mes}/${corteSaldos.anio}).` };
  }
  // Metas de colocación por asesor del ejercicio (Cartera → Metas): sin ellas no se calcula (no se usan valores supuestos)
  if (!metasRes.rows[0]) {
    return { ok: false, error: `Faltan las metas de colocación por asesor del ejercicio ${ejercicio} (Cartera de crédito → Metas).` };
  }

  // CIERRE SIMULADO (cualquier mes, diciembre incluido: el balance de diciembre suele cargarse
  // antes del asiento de cierre y trae todavía el resultado del año en 4 y 5).
  // Un balance a mitad de año todavía tiene el resultado del año en las
  // cuentas 4 y 5 (sin cerrar a patrimonio), así que Activo ≠ Pasivo +
  // Patrimonio. El motor arranca como si fuera un cierre de diciembre y solo
  // lee el patrimonio (31..36), por eso esa diferencia se lleva a 36
  // Resultados -- igual que haría el cierre contable. Con el cierre ya
  // registrado la diferencia es 0 y no se toca nada.
  let ajusteCierre = 0;
  if (saldos["1"] !== undefined && saldos["2"] !== undefined && saldos["3"] !== undefined) {
    const diferencia = saldos["1"] - (saldos["2"] + saldos["3"]);
    if (Math.abs(diferencia) >= 0.5) {
      ajusteCierre = Math.round(diferencia * 100) / 100;
      saldos["36"] = (saldos["36"] ?? 0) + ajusteCierre;
      saldos["3"] = saldos["3"] + ajusteCierre;
    }
  }

  // Parámetros institucionales del ejercicio (salario básico, IESS, fondo de reserva, fondo de liquidez).
  const empleadosNomina = nominaRes.rows as unknown as FilaEmpleadoNomina[];
  try {
    const pi = await leerParametrosInstitucionales(ejercicio);
    const vigentes = Object.fromEntries(Object.entries(pi).map(([k, v]) => [k, v.valor])) as unknown as ParametrosVigentes;
    adjuntarParametrosVigentes(saldos, vigentes);
    adjuntarParametrosVigentes(empleadosNomina, vigentes);
  } catch (e) {
    fallo("no se pudieron leer los parámetros institucionales", e);
  }

  // Fondos disponibles: límites de caja de la agencia y días de cobertura en bancos.
  // Viajan pegados a los saldos; el reparto de la 11 (Balance y Fondos disponibles) los lee.
  try {
    adjuntarParametrosFondos(saldos, { ...(await fondosPrevios), ejercicio });
  } catch (e) {
    fallo("parámetros de fondos disponibles no disponibles, Caja mantiene el saldo del corte", e);
  }

  // Contribuciones (COSEDE y SEPS): lo real del año anterior al ejercicio para calibrar tasas y bases.
  try {
    adjuntarContribuciones(saldos, await leerContribucionesReales(db, agenciaNombre, ejercicio));
  } catch (e) {
    fallo("históricos de contribuciones no disponibles, se usan las tasas guardadas o de la norma", e);
  }

  // Provisión de cartera: % final por línea según Cartera → Parámetros → Provisión.
  // Viaja pegado a los saldos; el orquestador lo lee (ver lib/calc/provision.ts).
  // Provisión por flow rates (tramos de mora): estado inicial = último corte de Calificación de Cartera.
  try {
    const pf = await provisionFlowPrevia;
    if (pf) {
      // referencia del modelo: el comportamiento real de la cartera de la agencia (pase a riesgo y recuperación de vencida)
      pf.referencia = await leerReferenciaCartera(db, agenciaNombre, creditoRes.rows as unknown as FilaParametroCredito[]).catch((e) => { fallo("no se pudo leer la referencia de cartera para la provisión", e); return null; });
      pf.periodoBalance = `${corteSaldos.anio}-${String(corteSaldos.mes).padStart(2, "0")}`;
      adjuntarProvisionFlow(saldos, pf);
    }
  } catch (e) {
    fallo("modelo de provisión por flow rates no disponible, se usa el % de provisión", e);
  }
  try {
    adjuntarParametrosProvision(saldos, await provisionPrevia);
  } catch (e) {
    fallo("parámetros de provisión no disponibles, se usa el % del balance", e);
  }

  const parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = otrosPasivoRes.rows.map((r) => ({
    concepto: r.concepto as string, mes: r.mes as number, monto: r.monto as number,
  }));
  // Interés de mora: el escrito en Planificación; si no hay, el real de la agencia (automático, se actualiza con cada ER
  // cargado), que viaja como el parámetro de la agencia para que el motor lo use igual; sin datos, el institucional.
  let interesMora: InsumosAgencia["interesMora"];
  {
    const guardado = interesMoraDe(parametrosOtrosPasivo);
    if (guardado !== null) interesMora = { origen: "manual", valor: guardado };
    else {
      // hasta el corte de los saldos (nunca meses posteriores al último balance cargado)
      const auto = await interesMoraRealAgencia(db, agenciaNombre, `${corteSaldos.anio}-${String(corteSaldos.mes).padStart(2, "0")}`).catch((e) => { fallo("no se pudo calcular el interés de mora real", e); return null; });
      if (auto) {
        interesMora = { origen: "automatico", valor: auto.valor, desde: auto.desde, hasta: auto.hasta };
        for (let m = 1; m <= 12; m++) parametrosOtrosPasivo.push({ concepto: CONCEPTO_INTERES_MORA, mes: m, monto: auto.valor });
      } else interesMora = { origen: "institucional", valor: Number((metasRes.rows[0] as unknown as MetasCreditoInstitucional | undefined)?.relacion_mora ?? RELACION_MORA_INTERES_NORMAL) };
    }
  }

  const factoresDepreciacion = Object.fromEntries(
    factoresRes.rows.map((r) => [r.categoria as string, r.factor_anual as number])
  ) as FactoresDepreciacion;

  // Registro de activos fijos: si existe, su depreciación bien por bien viaja
  // pegada a los factores y el orquestador la usa en lugar del cálculo plano.
  const registro = await registroPrevio;
  if (registro) {
    adjuntarDepreciacionRegistro(factoresDepreciacion, depreciacionRegistroPorCategoria(registro.bienes, registro.fechaCorte, ejercicio));
  }

  // Gastos anticipados (1904), diferidos (1905) y materiales (1906): pagos, gasto y saldo salen del registro de partidas
  try {
    const partidas = await diferidosPrevios;
    const fechaCorte = new Date(Date.UTC(corteSaldos.anio, corteSaldos.mes, 0)).toISOString().slice(0, 10);
    const sc = (k: string) => Math.abs(Number(saldos[k]) || 0);
    const nombres = partidas.length ? await nombresCuentasGasto(db) : {};
    // 190410 anticipos a terceros: saldo del balance (si trae la subcuenta) y variación mensual (Otros activos → Gastos anticipados)
    const variacion = Array.from({ length: 12 }, (_, m) => Number(parametrosOtrosPasivo.find((f) => f.concepto === CONCEPTO_ANTICIPOS && Number(f.mes) === m + 1)?.monto ?? 0) || 0);
    const conSub = Object.keys(saldos).some((k) => k.length === 6 && k.startsWith("1904"));
    const proyDif = proyectarDiferidos(partidas, ejercicio, fechaCorte, { "1904": sc("1904"), "1905": sc("1905"), "1906": sc("1906") }, nombres,
      { saldoCorte: conSub ? sc("190410") : null, variacionPorMes: variacion });
    // 1906: plan mensual de compras y consumo (450705) de la agencia; por defecto, su promedio histórico
    agregarPlanMateriales(proyDif, await planMaterialesAgencia(db, agenciaNombre, ejercicio, parametrosOtrosPasivo, sc("1906")));
    adjuntarDiferidos(saldos, proyDif);
  } catch (e) {
    fallo("gastos anticipados y diferidos no disponibles", e);
  }

  // Inversiones (cuenta 13): si la agencia tiene títulos registrados, el interés 5103 sale del
  // registro (reemplaza lo escrito a mano en Ingresos) y el Balance reparte 11/13 con el registro.
  let filasPresupuesto = presupuestoRes.rows as unknown as FilaPresupuestoDepartamental[];
  try {
    const inv = await inversionesPrevias;
    if (inv.titulos.length > 0) {
      const fechaCorte = new Date(Date.UTC(corteSaldos.anio, corteSaldos.mes, 0)).toISOString().slice(0, 10);
      const proy = proyectarInversiones(inv.titulos, inv.parametros, ejercicio, fechaCorte);
      adjuntarInversiones(saldos, proy);
      filasPresupuesto = [
        ...filasPresupuesto.filter((f) => !String(f.concepto).replace(/\D/g, "").startsWith("5103")),
        ...proy.interesDevengadoPorMes.map((monto, i) => ({
          departamento: "Inversiones", concepto: "5103", cuenta_nombre: "Intereses y descuentos de inversiones en títulos valores", mes: i + 1, monto,
        })),
      ];
    }
  } catch (e) {
    fallo("inversiones no disponibles, se usa el reparto fijo del balance", e);
  }

  // Seguros de gastos anticipados con gasto en 4503: entran como filas del presupuesto (Servicios varios); el motor
  // las descuenta del efectivo (se pagaron al contratar)
  {
    const dif = diferidosDe(saldos);
    const seguros = dif ? (["1904", "1905"] as const).flatMap((g) => Object.entries(dif.grupos[g].gastoPorCuenta).filter(([k]) => k.startsWith("4503"))) : [];
    if (dif && seguros.length) {
      // el registro de pólizas reemplaza lo escrito a mano SOLO en la cuenta de cada póliza (sin esto se sumaría dos veces).
      // Las demás cuentas del mismo grupo (ej. 45032555 ahorro crecer, 45032565 desgravamen) siguen con lo cargado en la hoja.
      const prefijos = [...new Set(seguros.map(([k]) => k.replace(/\D/g, "")))];
      filasPresupuesto = filasPresupuesto.filter((f) => !prefijos.some((x) => String(f.concepto).replace(/\D/g, "").startsWith(x)));
      for (const [k, v] of seguros) filasPresupuesto = [...filasPresupuesto, ...v.map((monto, i) => ({ departamento: "Gastos anticipados", concepto: k, cuenta_nombre: dif.nombres?.[k] ?? "Seguros", mes: i + 1, monto }))];
    }
  }

  // Rendimiento del Fondo de liquidez (53040505): valor del fondo (1902) × tasa anual ÷ 12, capitalizado. La tasa es la escrita
  // para la agencia o, sin ella, la real del año (530405 acumulado al corte ÷ meses × 12 ÷ 1902). Reemplaza lo escrito a mano
  // en 530405 y no es efectivo (el motor la descuenta del Flujo y la suma a la 1902).
  try {
    const guardada = parametrosOtrosPasivo.filter((f) => f.concepto === CONCEPTO_RENDIMIENTO_FL);
    const per = `${corteSaldos.anio}-${String(corteSaldos.mes).padStart(2, "0")}`;
    const h = await db.execute({ sql: `SELECT tipo, codigo, valor FROM historico_cuentas WHERE oficina = ? AND periodo = ? AND ((tipo = 'ER' AND codigo IN ('530405', '53040505', '5304')) OR (tipo = 'BAL' AND codigo = '1902'))`, args: [agenciaNombre, per] }).catch((e) => { fallo("no se pudo leer el histórico del fondo de liquidez", e); return { rows: [] as Record<string, unknown>[] }; });
    const val = (t: string, c: string) => { const x = h.rows.find((r) => String(r.tipo) === t && String(r.codigo) === c); return x ? Math.abs(Number(x.valor) || 0) : null; };
    const er = val("ER", "530405") ?? val("ER", "53040505") ?? val("ER", "5304");
    const s1902 = val("BAL", "1902") ?? Math.abs(Number(saldos["1902"]) || 0);
    const real = er !== null && s1902 > 0 ? (er / corteSaldos.mes) * 12 / s1902 : null;
    const tasa = guardada.length ? guardada.reduce((t, f) => t + (Number(f.monto) || 0), 0) / guardada.length : real ?? 0;
    const porMes = proyectarRendimientoFL(Math.abs(Number(saldos["1902"]) || 0), tasa);
    adjuntarRendimientoFL(saldos, { tasa, real, guardada: guardada.length > 0, porMes, acumuladoCorte: er, base1902: s1902 });
    if (porMes.some((v) => v > 0)) {
      filasPresupuesto = [
        ...filasPresupuesto.filter((f) => !String(f.concepto).replace(/\D/g, "").startsWith("530405")),
        ...porMes.map((monto, i) => ({ departamento: "Fondo de liquidez", concepto: "53040505", cuenta_nombre: "Rendimiento por fideicomiso de liquidez (BCE)", mes: i + 1, monto })),
      ];
    }
  } catch (e) {
    fallo("rendimiento del fondo de liquidez no disponible", e);
  }

  // 51 · Intereses ganados por depósitos (5101) y préstamos internos (5190): se calculan siempre y
  // reemplazan lo escrito a mano en Ingresos. Ambos dependen de saldos que a su vez dependen del
  // Flujo (el interés entra a bancos), así que se calcula en 3 vueltas sobre el saldo del mes anterior.
  // 5190 usa SOLO las subcuentas de 1908 que dicen "préstamos internos" (no todo el saldo de 1908),
  // con su saldo del corte en los 12 meses.
  try {
    const cat = await catalogo1908Previo;
    const cuentasInternas = detectarPrestamosInternos(
      cat.rows.map((r) => ({ codigo: String(r.codigo), nombre: String(r.nombre ?? "") })), saldos as Record<string, number>
    );
    const internosCorte = cuentasInternas.reduce((t, c) => t + c.saldo, 0);
    // y al revés: lo que la agencia recibe prestado de otras oficinas (2908 · préstamos) → paga 41059005 con la misma tasa
    const cuentasRecibidas = detectarPrestamosInternos(
      cat.rows.map((r) => ({ codigo: String(r.codigo), nombre: String(r.nombre ?? "") })), saldos as Record<string, number>, "2908"
    );
    const recibidoCorte = Math.abs(cuentasRecibidas.reduce((t, c) => t + c.saldo, 0));
    const tB = tasaMensual(parametrosOtrosPasivo, "ingresos_tasa_bancos", 0.35);
    // préstamos internos: el saldo baja con los abonos (y sube con los nuevos) de la pestaña Transferencias internas;
    // la tasa es la misma para todas las oficinas (la que cobra y la que paga usan el mismo interés)
    const pi = await prestamosDeAgencia(db, agenciaNombre, ejercicio).catch((e) => { fallo("no se pudieron leer los préstamos internos", e); return null; });
    if (pi) adjuntarPrestamosInternos(saldos, pi);
    const tI0 = tasaMensual(parametrosOtrosPasivo, "ingresos_tasa_prestamos_internos", TASA_PRESTAMOS_INTERNOS);
    const tI = pi ? { valores: Array(12).fill(pi.tasa) as number[], guardada: tI0.guardada } : tI0;
    const hayI = (v: number[] | undefined) => !!v && v.some((x) => x > 0.005);
    // 5190 también para los préstamos nuevos del año (sin saldo al corte)
    const calcula5190 = cuentasInternas.length > 0 || hayI(pi?.interesCobrado);
    const paga410590 = hayI(pi?.interesPagado);
    const saldo1103 = Number(saldos["1103"]) || 0;

    const conCodigo = (n: NodoBalance, codigo: string): NodoBalance | null =>
      n.codigo === codigo ? n : (n.hijos ?? []).reduce<NodoBalance | null>((hallado, h) => hallado ?? conCodigo(h, codigo), null);
    // Toda la 51 sale calculada: 5101 y 5190 aquí, 5103 del registro de Inversiones (0 si no hay títulos),
    // 5104 de Cartera. Lo escrito a mano antes bajo la 51 ya no se usa.
    const inv = inversionesDe(saldos);
    const sin51 = filasPresupuesto.filter((f) => { const c = String(f.concepto).replace(/\D/g, ""); return !c.startsWith("51") && !c.startsWith("410590"); });
    const filas5103 = inv
      ? inv.interesDevengadoPorMes.map((monto, i) => ({ departamento: "Inversiones", concepto: "5103", cuenta_nombre: "Intereses y descuentos de inversiones en títulos valores", mes: i + 1, monto }))
      : [];
    const armarFilas = (i5101: number[], i5190: number[]) => [
      ...sin51,
      ...filas5103,
      ...i5101.map((monto, i) => ({ departamento: "Inversiones", concepto: "5101", cuenta_nombre: "Depósitos", mes: i + 1, monto })),
      ...(calcula5190 ? i5190.map((monto, i) => ({ departamento: "Inversiones", concepto: "5190", cuenta_nombre: "Otros intereses y descuentos · préstamos internos", mes: i + 1, monto })) : []),
      ...(recibidoCorte > 0 || paga410590 ? i410590.map((monto, i) => ({ departamento: "Inversiones", concepto: "41059005", cuenta_nombre: "Intereses pagados a Matriz y otras agencias", mes: i + 1, monto })) : []),
    ] as FilaPresupuestoDepartamental[];

    // Vuelta 0: saldos del corte en todos los meses
    let bancos = interesSobreSaldoAnterior(saldo1103, Array(12).fill(saldo1103), tB.valores);
    const cursoPrestado = (corte: number) => pi ? pi.prestadoSaldo.map((v) => Math.max(0, corte - (pi.prestadoCorte - v))) : Array(12).fill(corte);
    const cursoRecibido = (corte: number) => pi ? pi.recibidoSaldo.map((v) => Math.max(0, corte - (pi.recibidoCorte - v))) : Array(12).fill(corte);
    const internos0 = interesSobreSaldoAnterior(Math.abs(internosCorte), cursoPrestado(Math.abs(internosCorte)), tI.valores);
    // interés como contabilidad (por días, base 360, abono el 4 y pago el 25) cuando hay plan de préstamos
    const internos = pi ? { base: internos0.base, interes: pi.interesCobrado } : internos0;
    // préstamos recibidos: saldo del corte en los 12 meses (como 5190), a la tasa interna de la agencia
    const i410590 = pi ? pi.interesPagado : interesSobreSaldoAnterior(recibidoCorte, cursoRecibido(recibidoCorte), tI.valores).interes;
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const b = calcularBalanceGeneralMatriz(
        saldos, captacionesRes.rows as unknown as FilaParametroCaptaciones[], creditoRes.rows as unknown as FilaParametroCredito[],
        armarFilas(bancos.interes, internos.interes), empleadosNomina, agenciaNombre,
        oficialesRes.rows as unknown as FilaOficialCredito[], metasRes.rows[0] as unknown as MetasCreditoInstitucional,
        factoresDepreciacion, parametrosOtrosPasivo
      );
      const n1103 = conCodigo(b.activo, "1103")?.valores ?? Array(12).fill(saldo1103);
      bancos = interesSobreSaldoAnterior(saldo1103, n1103, tB.valores);
    }
    filasPresupuesto = armarFilas(bancos.interes, internos.interes);

    const mesesCorte = corteSaldos.mes;
    const s = saldos as Record<string, number>;
    adjuntarIngresos51(saldos, {
      tasaBancosPorMes: tB.valores, tasaInternosPorMes: tI.valores,
      tasaBancosGuardada: tB.guardada, tasaInternosGuardada: tI.guardada,
      basePorMesBancos: bancos.base, i5101PorMes: bancos.interes,
      cuentasInternas, basePorMesInternos: calcula5190 ? internos.base : Array(12).fill(0),
      i5190PorMes: calcula5190 ? internos.interes : Array(12).fill(0), calcula5190,
      i5103PorMes: inv ? [...inv.interesDevengadoPorMes] : null,
      saldo13Corte: saldoCuenta(s, "13") ?? 0,
      verificacion5101: verificar(saldoCuenta(s, "5101"), mesesCorte, saldo1103, tB.valores[0]),
      verificacion5190: calcula5190 ? verificar(saldoCuenta(s, "5190"), mesesCorte, internosCorte, tI.valores[0]) : null,
      cuentasRecibidas, i410590PorMes: recibidoCorte > 0 || paga410590 ? i410590 : Array(12).fill(0),
      verificacion410590: recibidoCorte > 0 ? verificar(saldoCuenta(s, "41059005") ?? saldoCuenta(s, "410590"), mesesCorte, recibidoCorte, tI.valores[0]) : null,
      corte: corteSaldos,
    });
  } catch (e) {
    fallo("no se pudo calcular 5101/5190, se usa lo escrito en Ingresos", e);
  }

  return {
    ok: true,
    insumos: {
      saldos,
      paramsCaptaciones: captacionesRes.rows as unknown as FilaParametroCaptaciones[],
      paramsCredito: creditoRes.rows as unknown as FilaParametroCredito[],
      filasPresupuesto,
      empleados: empleadosNomina,
      oficialesCredito: oficialesRes.rows as unknown as FilaOficialCredito[],
      metasCredito: metasRes.rows[0] as unknown as MetasCreditoInstitucional,
      factoresDepreciacion,
      parametrosOtrosPasivo,
      corteSaldos,
      ajusteCierre,
      lecturasFallidas,
      registroActivosFijos: registro ? { fechaCorte: registro.fechaCorte, bienes: registro.bienes.length } : null,
      interesMora,
    },
  };
}