"use client";

import { useEjercicio } from "../lib/seleccion";

/** «· 2027» junto al título de cada pantalla: el ejercicio en uso (se elige en Inicio). */
export default function AnioEjercicio() {
  const [ejercicio] = useEjercicio();
  return <span className="font-normal" style={{ color: "#6B7570" }}> · {ejercicio}</span>;
}
