import { redirect } from "next/navigation";

/** La antigua sección Pasivo se separó en Cuentas por pagar, Obligaciones financieras y Otros pasivos. */
export default function PasivoPage() {
  redirect("/cuentas-por-pagar");
}
