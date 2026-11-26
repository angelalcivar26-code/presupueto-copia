"use client";

import { useDatos } from "../../lib/useDatos";
import { ejercicioEnUso } from "../../lib/seleccion";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import { E, NUM, T, p1, u } from "./EstudioComun";

/**
 * Cuentas sin supuestos propios en el Estudio (salen de otras cuentas o del flujo): solo se comparan lo real y lo
 * presupuestado, sin editar nada. Balance: saldo y crecimiento de los últimos 12 meses frente al saldo presupuestado
 * a diciembre y su crecimiento desde el corte. 44 (estado de resultados): gasto de los últimos 12 meses frente al del año.
 */
export const CUENTAS_COMPARACION = ["11", "16", "18", "19", "25", "29", "31", "33", "36", "44"];

interface Nodo { codigo: string; valores: number[]; hijos?: Nodo[] }
interface RespBalance { activo?: Nodo; pasivo?: Nodo; patrimonio?: Nodo }
interface RespER { egresos?: Nodo; cuentas?: { egresos?: Nodo } | null }

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiqueta = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;
const menos12 = (p: string) => `${Number(p.slice(0, 4)) - 1}-${p.slice(5, 7)}`;
function buscar(n: Nodo | undefined, c: string): Nodo | null {
  if (!n) return null;
  if (n.codigo === c) return n;
  for (const h of n.hijos ?? []) { const x = buscar(h, c); if (x) return x; }
  return null;
}
const crec = (a: number | null, b: number | null) => (a !== null && b !== null && Math.abs(b) >= 1 ? a / b - 1 : null);

export function DetalleComparacion({ h, ag, cuenta, nombre }: { h: HistoricoEstudio; ag: string; cuenta: string; nombre: string }) {
  const ej = ejercicioEnUso();
  const esER = cuenta === "44";
  const q = `agencia=${encodeURIComponent(ag)}`;
  const bal = useDatos<RespBalance>(esER ? null : `/api/balance-general?${q}`);
  const er = useDatos<RespER>(esER ? `/api/estado-resultados?${q}` : null);
  const tabla = esER ? h.er : h.bal;
  const periodos = Object.keys(tabla).filter((p) => typeof tabla[p]?.[cuenta] === "number").sort();
  const ult = periodos[periodos.length - 1];
  const cargando = esER ? !er.datos && !er.error : !bal.datos && !bal.error;

  if (!ult) return <Aviso texto={`${ag} no tiene ${esER ? "estados de resultados" : "balances"} mensuales cargados en Históricos con la cuenta ${cuenta}.`} />;
  if (cargando) return <Aviso texto="Cargando el presupuesto…" />;

  const v = (p: string) => (typeof tabla[p]?.[cuenta] === "number" ? tabla[p][cuenta] : null);
  let filas: { label: string; real: string; pres: string; fuerte?: boolean }[];
  let cabReal: string, cabPres: string;

  if (esER) {
    // los estados de resultados son acumulados del año: últimos 12 meses = acumulado + diciembre anterior − mismo mes del año anterior
    const doce = (p: string) => {
      if (p.endsWith("-12")) return v(p);
      const a = v(p), dic = v(`${Number(p.slice(0, 4)) - 1}-12`), ant = v(menos12(p));
      return a !== null && dic !== null && ant !== null ? a + dic - ant : null;
    };
    const real = doce(ult), previo = doce(menos12(ult));
    const nodo = buscar(er.datos?.cuentas?.egresos ?? er.datos?.egresos, cuenta);
    const pres = nodo ? nodo.valores[11] : null;
    cabReal = `Últimos 12 meses a ${etiqueta(ult)}`; cabPres = `Año ${ej}`;
    filas = [
      { label: `${nombre}`, real: u(real), pres: u(pres), fuerte: true },
      { label: "Crecimiento", real: p1(crec(real, previo)), pres: p1(crec(pres, real)) },
      { label: "Variación en dólares", real: u(real !== null && previo !== null ? real - previo : null), pres: u(pres !== null && real !== null ? pres - real : null) },
    ];
  } else {
    // el presupuesto parte del último corte anterior a su enero
    const corte = periodos.filter((p) => Number(p.slice(0, 4)) < ej).pop() ?? null;
    const real = v(ult), previo = v(menos12(ult)), inicio = corte ? v(corte) : null;
    const raiz = cuenta.startsWith("1") ? bal.datos?.activo : cuenta.startsWith("2") ? bal.datos?.pasivo : bal.datos?.patrimonio;
    const nodo = buscar(raiz, cuenta);
    const pres = nodo ? nodo.valores[11] : null;
    cabReal = `Últimos 12 meses a ${etiqueta(ult)}`; cabPres = corte ? `De ${etiqueta(corte)} a dic-${String(ej).slice(2)}` : `A dic-${String(ej).slice(2)}`;
    filas = [
      { label: "Saldo", real: u(real), pres: u(pres), fuerte: true },
      { label: "Crecimiento", real: p1(crec(real, previo)), pres: p1(crec(pres, inicio)) },
      { label: "Variación en dólares", real: u(real !== null && previo !== null ? real - previo : null), pres: u(pres !== null && inicio !== null ? pres - inicio : null) },
    ];
  }

  return (
    <div className="flex flex-col gap-4 flex-1">
      <h2 className="m-0 text-[16px] font-semibold" style={{ color: E.tinta }}><span style={{ color: E.oro, ...NUM }}>{cuenta}</span> {nombre}</h2>
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <thead>
            <tr style={T.cab}>
              <th className={T.thIzq} aria-label="Concepto" />
              <th className={T.th}>Real<div className="text-[11px]">{cabReal}</div></th>
              <th className={T.th} style={{ paddingRight: 18 }}>Presupuesto {ej}<div className="text-[11px]">{cabPres}</div></th>
            </tr>
          </thead>
          <tbody>{filas.map((f) => (
            <tr key={f.label} style={{ ...T.fila, color: f.fuerte ? E.tinta : E.gris, fontWeight: f.fuerte ? 600 : 400 }}>
              <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>{f.label}</td>
              <td className={T.td}>{f.real}</td>
              <td className={T.td} style={{ paddingRight: 18 }}>{f.pres}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <p className="text-[13px] py-4 m-0" style={{ color: E.gris }}>{texto}</p>;
}
