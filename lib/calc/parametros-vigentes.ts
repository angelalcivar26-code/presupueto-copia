/**
 * Parámetros institucionales del ejercicio (Administración → Parámetros institucionales) para el
 * cálculo. Viajan pegados a los saldos y a la lista de empleados de la agencia (mismo patrón que
 * inversiones o provisión), así llegan al motor sin cambiar firmas. Sin valores: los de siempre.
 */
export interface ParametrosVigentes {
  sbu: number; iess_patronal: number; fondo_reserva: number; fondo_liquidez_pct: number; fondo_liquidez_meta: number;
}
export const VALORES_DE_SIEMPRE: ParametrosVigentes = {
  sbu: 482, iess_patronal: 0.1215, fondo_reserva: 0.0833, fondo_liquidez_pct: 0.059, fondo_liquidez_meta: 0.075,
};
const porObjeto = new WeakMap<object, ParametrosVigentes>();
export function adjuntarParametrosVigentes(o: object, p: ParametrosVigentes) { porObjeto.set(o, p); }
export function parametrosVigentesDe(o: object | null | undefined): ParametrosVigentes {
  return (o && porObjeto.get(o)) || VALORES_DE_SIEMPRE;
}
