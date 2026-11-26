import { redirect } from "next/navigation";

// El Plan de adquisiciones ahora es una pestaña dentro de Activos fijos.
export default function PlanAdquisicionesPage() {
  redirect("/activos-fijos?tab=plan");
}
