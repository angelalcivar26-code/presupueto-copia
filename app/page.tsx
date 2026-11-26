import { redirect } from "next/navigation";

// La ruta raíz "/" ya no muestra el Resumen antiguo: lleva directo a Inicio.
export default function Home() {
  redirect("/inicio");
}
