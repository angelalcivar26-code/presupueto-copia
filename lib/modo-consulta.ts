"use client";

/**
 * PERFIL DE CONSULTA EN PANTALLA: oculta los botones que guardan, editan o eliminan.
 *
 * Hay cientos de botones repartidos en las pantallas; en vez de marcarlos uno por uno, se reconocen por
 * su texto, título o etiqueta (Editar, Guardar, Eliminar, Agregar, Cargar…). Si alguno se escapara, el
 * servidor igual rechaza el guardado («Su perfil es de solo consulta»). No consulta la base.
 */
const VERBOS = /^(\+\s*)?(editar|guardar|eliminar|borrar|agregar|añadir|nuevo|nueva|cargar|subir|quitar|recalcular|cambiar|aplicar|importar|registrar|crear|copiar|restablecer|renombrar|duplicar|igualar|calcular y guardar|marcar|archivar|restaurar|deshacer|descartar|confirmar|seleccionar archivo)\b/i;
const PERMITIDOS = /^(cerrar|cancelar|ver|descargar|exportar|imprimir|anterior|siguiente|reintentar|seguir editando)/i;

function textoDe(el: HTMLElement): string {
  return [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent].map((x) => (x ?? "").trim()).find(Boolean) ?? "";
}

function esDeEdicion(el: HTMLElement): boolean {
  if (el.closest("aside, [data-permitir-consulta]")) return false; // menú lateral y filtros
  const t = textoDe(el);
  if (!t || PERMITIDOS.test(t)) return false;
  if (VERBOS.test(t)) return true;
  // Menús «⋯» de acciones de hoja y botones de solo ícono de papelera o lápiz
  return t === "⋯" || t === "…" || /^(eliminar|editar)/i.test(el.getAttribute("title") ?? "");
}

function ocultar(raiz: ParentNode) {
  raiz.querySelectorAll<HTMLElement>("main button, main [role='button'], main input[type='file'], main label:has(> input[type='file'])").forEach((el) => {
    if (el.dataset.ocultoConsulta) return;
    if (el instanceof HTMLInputElement || el.tagName === "LABEL" || esDeEdicion(el)) {
      el.dataset.ocultoConsulta = "1";
      el.style.display = "none";
    }
  });
}

let observador: MutationObserver | null = null;
export function activarModoConsulta() {
  if (typeof window === "undefined" || observador) return;
  document.body.dataset.soloConsulta = "1";
  ocultar(document);
  let pendiente = false;
  observador = new MutationObserver(() => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; ocultar(document); });
  });
  observador.observe(document.body, { childList: true, subtree: true, characterData: true });
}
