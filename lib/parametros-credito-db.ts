import type { getDb } from "./turso";

/**
 * Columnas de Cartera → Parámetros de crédito agregadas después de crear la tabla (se crean solas la primera vez):
 *  - pct_pase_riesgo: % mensual de la cartera por vencer que pasa a cartera en riesgo (no devenga + vencida).
 *    Vacío = como antes: (1 − % de recuperación de cuotas) × % de recuperación del período.
 *  - pct_precancelacion: % mensual de la cartera por vencer que se cancela antes del plazo (precancelaciones y
 *    renovaciones). Vacío = 0.
 *  - pct_precancelacion_vencida: % mensual del saldo en riesgo que se precancela con dinero. Vacío = el ritmo real de la
 *    agencia movido en la misma proporción que la precancelación de la cartera por vencer.
 */
let listo: Promise<void> | null = null;
export function asegurarColumnasCredito(db: ReturnType<typeof getDb>): Promise<void> {
  if (!listo) {
    listo = (async () => {
      for (const col of ["pct_pase_riesgo REAL", "pct_precancelacion REAL", "pct_precancelacion_vencida REAL"]) {
        try { await db.execute(`ALTER TABLE parametros_credito ADD COLUMN ${col}`); } catch { /* ya existe */ }
      }
    })().catch((e) => { listo = null; throw e; });
  }
  return listo;
}

interface FilaCreditoGuardar {
  linea: string; mes: number; monto_promedio?: number; tasa_interes_anual?: number; pct_recuperacion_periodo?: number;
  tasa_efectividad_recup?: number; num_operaciones_conceder?: number; tasa_recuperacion_vencida?: number; pct_distribucion?: number | null;
  pct_pase_riesgo?: number | null; pct_precancelacion?: number | null; pct_precancelacion_vencida?: number | null; modo_colocacion?: string;
}

/**
 * Guarda (inserta o actualiza) una fila de parámetros de crédito. Las columnas nuevas (pase a riesgo, precancelación)
 * solo se cambian si la fila las trae: una pantalla que no las conoce no las borra.
 */
export function sqlGuardarCredito(agenciaId: number, f: FilaCreditoGuardar) {
  const trae = (k: keyof FilaCreditoGuardar) => (k in f ? 1 : 0);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    sql: `INSERT INTO parametros_credito
            (agencia_id, linea, mes, modo_colocacion, monto_promedio, tasa_interes_anual, pct_recuperacion_periodo,
             tasa_efectividad_recup, num_operaciones_conceder, tasa_recuperacion_vencida, pct_distribucion,
             pct_pase_riesgo, pct_precancelacion, pct_precancelacion_vencida)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(agencia_id, linea, mes) DO UPDATE SET
            monto_promedio = excluded.monto_promedio, tasa_interes_anual = excluded.tasa_interes_anual,
            pct_recuperacion_periodo = excluded.pct_recuperacion_periodo, tasa_efectividad_recup = excluded.tasa_efectividad_recup,
            num_operaciones_conceder = excluded.num_operaciones_conceder, tasa_recuperacion_vencida = excluded.tasa_recuperacion_vencida,
            pct_distribucion = excluded.pct_distribucion,
            pct_pase_riesgo = CASE WHEN ? = 1 THEN excluded.pct_pase_riesgo ELSE parametros_credito.pct_pase_riesgo END,
            pct_precancelacion = CASE WHEN ? = 1 THEN excluded.pct_precancelacion ELSE parametros_credito.pct_precancelacion END,
            pct_precancelacion_vencida = CASE WHEN ? = 1 THEN excluded.pct_precancelacion_vencida ELSE parametros_credito.pct_precancelacion_vencida END`,
    args: [
      agenciaId, f.linea, f.mes, f.modo_colocacion ?? "CAPACIDAD_ARCHIVO", f.monto_promedio ?? 0, f.tasa_interes_anual ?? 0,
      f.pct_recuperacion_periodo ?? 0, f.tasa_efectividad_recup ?? 0, f.num_operaciones_conceder ?? 0, f.tasa_recuperacion_vencida ?? 0,
      num(f.pct_distribucion), num(f.pct_pase_riesgo), num(f.pct_precancelacion), num(f.pct_precancelacion_vencida),
      trae("pct_pase_riesgo"), trae("pct_precancelacion"), trae("pct_precancelacion_vencida"),
    ],
  };
}
