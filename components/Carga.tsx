"use client";

/**
 * Indicadores de carga comunes a todas las pantallas (mismo estilo de la herramienta).
 *  - <Actualizando />   aviso pequeño junto al título mientras llegan los datos nuevos
 *  - <EsqueletoTabla /> la forma de la página en gris la primera vez que se abre
 */

// Paleta institucional (verde #005A28 y grises neutros), igual al resto de la herramienta.
const C = { borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F3F5F4", texto2: "#3D4843", acento: "#005A28", acentoSuave: "#E3EEE7" };

export function Actualizando({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[10px] font-semibold"
          style={{ background: C.acentoSuave, color: C.acento }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C.acento }} />
      Actualizando
    </span>
  );
}

function Barra({ ancho, alto = 10 }: { ancho: string | number; alto?: number }) {
  return <span className="block rounded-md animate-pulse" style={{ width: ancho, height: alto, background: C.beige }} />;
}

export function EsqueletoTabla({ filas = 6, indicadores = true }: { filas?: number; indicadores?: boolean }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando">
      {indicadores && (
        <div className="flex flex-wrap py-4 rounded-lg bg-white" style={{ border: `1px solid ${C.borde}` }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-1 min-w-[198px] px-6 py-1 flex flex-col gap-2.5" style={i < 2 ? { borderRight: `1px solid ${C.beige}` } : undefined}>
              <Barra ancho={110} alto={9} />
              <Barra ancho={150} alto={20} />
              <Barra ancho={180} alto={9} />
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg bg-white px-5 py-4 flex flex-col gap-3.5" style={{ border: `1px solid ${C.borde}` }}>
        <Barra ancho={220} alto={14} />
        <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.borde}` }}>
          <div className="h-[34px] flex items-center px-4 gap-6" style={{ background: C.crema }}>
            <Barra ancho={160} alto={9} />
            <div className="flex-1 flex justify-end gap-6">{Array.from({ length: 8 }, (_, i) => <Barra key={i} ancho={40} alto={9} />)}</div>
          </div>
          {Array.from({ length: filas }, (_, r) => (
            <div key={r} className="h-9 flex items-center px-4 gap-6" style={{ borderTop: `1px solid ${C.beige}` }}>
              <Barra ancho={140 + ((r * 37) % 90)} alto={9} />
              <div className="flex-1 flex justify-end gap-6">{Array.from({ length: 8 }, (_, i) => <Barra key={i} ancho={48} alto={9} />)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}