/**
 * Insumos del motor del presupuesto en un formato que viaja por la red (JSON).
 *
 * Algunos datos viajan pegados al objeto de saldos o de factores (WeakMap): provisión, flow rates, fondos,
 * inversiones, intereses 51 y depreciación del registro. Aquí se separan para enviarlos y se vuelven a pegar
 * en el navegador, así el mismo motor corre allí con los mismos resultados.
 */
import type {
  SaldosPorCodigo, FilaParametroCaptaciones, FilaParametroCredito, FilaPresupuestoDepartamental, FilaEmpleadoNomina,
  FilaOficialCredito, MetasCreditoInstitucional, FactoresDepreciacion, FilaParametroOtrosPasivo,
} from "./orquestador";
import { adjuntarParametrosProvision, parametrosProvisionDe } from "./provision";
import { adjuntarProvisionFlow, provisionFlowDe, type InsumosProvisionFlow } from "./provision-flow";
import { adjuntarParametrosFondos, parametrosFondosDe } from "./fondos";
import { adjuntarDiferidos, diferidosDe } from "./activos-diferidos";
import { adjuntarInversiones, inversionesDe } from "./inversiones";
import { adjuntarIngresos51, ingresos51De } from "./ingresos-51";
import { adjuntarDepreciacionRegistro, depreciacionRegistroDe } from "./activo-fijo";
import { adjuntarContribuciones, contribucionesDe } from "./contribuciones";
import { adjuntarRendimientoFL, rendimientoFLDe } from "./otros-activos";
import { adjuntarPrestamosInternos, prestamosInternosDe } from "./prestamos-internos";

export interface InsumosMotor {
  saldos: SaldosPorCodigo;
  paramsCaptaciones: FilaParametroCaptaciones[];
  paramsCredito: FilaParametroCredito[];
  filasPresupuesto: FilaPresupuestoDepartamental[];
  empleados: FilaEmpleadoNomina[];
  oficialesCredito: FilaOficialCredito[];
  metasCredito: MetasCreditoInstitucional;
  factoresDepreciacion: FactoresDepreciacion;
  parametrosOtrosPasivo: FilaParametroOtrosPasivo[];
  /** De dónde sale el % de interés de mora (solo para mostrarlo; el valor ya viaja en parametrosOtrosPasivo). */
  interesMora?: { origen: "manual" | "automatico" | "institucional"; valor: number; desde?: string; hasta?: string };
}

export interface PaqueteMotor {
  ins: InsumosMotor;
  adj: {
    provision: ReturnType<typeof parametrosProvisionDe>;
    flow: InsumosProvisionFlow | null;
    fondos: ReturnType<typeof parametrosFondosDe>;
    inversiones: ReturnType<typeof inversionesDe>;
    i51: ReturnType<typeof ingresos51De>;
    depreciacion: Record<string, number[]> | null;
    diferidos?: ReturnType<typeof diferidosDe>;
    contribuciones?: ReturnType<typeof contribucionesDe>;
    rendimientoFL?: ReturnType<typeof rendimientoFLDe>;
    prestamosInternos?: ReturnType<typeof prestamosInternosDe>;
  };
}

export function empaquetar(i: InsumosMotor): PaqueteMotor {
  return {
    ins: {
      saldos: i.saldos, paramsCaptaciones: i.paramsCaptaciones, paramsCredito: i.paramsCredito, filasPresupuesto: i.filasPresupuesto,
      empleados: i.empleados, oficialesCredito: i.oficialesCredito, metasCredito: i.metasCredito, factoresDepreciacion: i.factoresDepreciacion,
      parametrosOtrosPasivo: i.parametrosOtrosPasivo, interesMora: i.interesMora,
    },
    adj: {
      provision: parametrosProvisionDe(i.saldos), flow: provisionFlowDe(i.saldos), fondos: parametrosFondosDe(i.saldos),
      inversiones: inversionesDe(i.saldos), i51: ingresos51De(i.saldos), depreciacion: depreciacionRegistroDe(i.factoresDepreciacion) ?? null,
      contribuciones: contribucionesDe(i.saldos), diferidos: diferidosDe(i.saldos),
      rendimientoFL: rendimientoFLDe(i.saldos), prestamosInternos: prestamosInternosDe(i.saldos),
    },
  };
}

/** Insumos listos para el motor (con todo lo que viaja pegado a los saldos). */
export function desempaquetar(p: PaqueteMotor): InsumosMotor {
  const saldos = { ...p.ins.saldos }, factoresDepreciacion = { ...p.ins.factoresDepreciacion };
  const a = p.adj;
  if (a.fondos) adjuntarParametrosFondos(saldos, a.fondos);
  if (a.flow) adjuntarProvisionFlow(saldos, a.flow);
  if (a.provision) adjuntarParametrosProvision(saldos, a.provision);
  if (a.inversiones) adjuntarInversiones(saldos, a.inversiones);
  if (a.i51) adjuntarIngresos51(saldos, a.i51);
  if (a.depreciacion) adjuntarDepreciacionRegistro(factoresDepreciacion, a.depreciacion);
  if (a.contribuciones) adjuntarContribuciones(saldos, a.contribuciones);
  if (a.diferidos) adjuntarDiferidos(saldos, a.diferidos);
  if (a.rendimientoFL) adjuntarRendimientoFL(saldos, a.rendimientoFL);
  if (a.prestamosInternos) adjuntarPrestamosInternos(saldos, a.prestamosInternos);
  return { ...p.ins, saldos, factoresDepreciacion };
}
