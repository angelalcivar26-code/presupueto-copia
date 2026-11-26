"use client";
/**
 * Zona para subir archivos de Excel: uno, varios o carpetas comprimidas (.zip). Devuelve la lista de archivos .xlsx/.xls
 * (los .zip se abren y se toman sus Excel, en cualquier subcarpeta). La agencia y el mes de cada archivo se leen de su
 * contenido en cada pestaña, nunca del nombre del archivo ni de la carpeta.
 */
import JSZip from "jszip";
import { Upload } from "lucide-react";
import { C } from "./ActivosComun";

const ES_EXCEL = /\.(xlsx|xls)$/i;
const OCULTO = /(^|\/)(~\$|\._|__MACOSX\/)/;

export async function expandirArchivos(lista: FileList | File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of Array.from(lista)) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const entradas: { ruta: string; e: JSZip.JSZipObject }[] = [];
      zip.forEach((ruta, e) => { if (!e.dir && ES_EXCEL.test(ruta) && !OCULTO.test(ruta)) entradas.push({ ruta, e }); });
      for (const { ruta, e } of entradas.sort((a, b) => a.ruta.localeCompare(b.ruta))) out.push(new File([await e.async("blob")], ruta.split("/").pop()!));
    } else if (ES_EXCEL.test(f.name)) out.push(f);
  }
  return out;
}

export default function ZonaArchivos({ texto, onArchivos, deshabilitada }: { texto: string; onArchivos: (f: File[]) => void; deshabilitada?: boolean }) {
  async function tomar(l: FileList | null) {
    if (!l?.length) return;
    onArchivos(await expandirArchivos(l));
  }
  return (
    <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!deshabilitada) tomar(e.dataTransfer.files); }}
           className="flex flex-col items-center justify-center gap-2 h-32 rounded-md cursor-pointer bg-white hover:bg-[#F5F7F6]" style={{ border: "1.5px dashed #B9C3BD", opacity: deshabilitada ? 0.6 : 1 }}>
      <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: C.acentoSuave }}><Upload className="w-5 h-5" style={{ color: C.acento }} /></span>
      <span className="text-[13px] font-semibold" style={{ color: C.texto }}>{texto}</span>
      <span className="text-[11.5px]" style={{ color: C.tenue }}>Uno o varios archivos .xlsx, o carpetas comprimidas (.zip)</span>
      <input type="file" multiple accept=".xlsx,.xls,.zip" className="hidden" disabled={deshabilitada} onChange={(e) => { tomar(e.target.files); e.target.value = ""; }} />
    </label>
  );
}
