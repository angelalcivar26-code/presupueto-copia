/**
 * Pantalla de espera al cambiar de sección: aparece AL INSTANTE al hacer clic en el menú
 * (en lugar de quedarse la pantalla anterior congelada) con la misma forma que las secciones:
 * título, pestañas, tarjetas y tabla. Se reemplaza sola cuando la sección está lista.
 */
export default function Cargando() {
  const bloque = (w: string, h: number, extra = "") => (
    <div className={`rounded animate-pulse ${extra}`} style={{ width: w, height: h, background: "#E1E6E3" }} />
  );
  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: "#EEF1EF" }} aria-busy="true" aria-label="Cargando sección">
      <div className="flex items-center gap-3">{bloque("280px", 30)}<span className="flex-1" />{bloque("110px", 24)}</div>
      <div className="flex items-end gap-7 pb-2.5" style={{ borderBottom: "1px solid #D3D9D5" }}>
        {bloque("90px", 18)}{bloque("110px", 18)}{bloque("100px", 18)}<span className="flex-1" />{bloque("230px", 34)}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tarjeta px-5 py-4 flex flex-col gap-2.5">{bloque("55%", 14)}{bloque("70%", 26)}{bloque("45%", 12)}</div>
        ))}
      </div>
      <div className="tarjeta overflow-hidden">
        <div className="px-4 py-3" style={{ borderBottom: "1px solid #E6EAE8" }}>{bloque("220px", 20)}</div>
        <div className="p-4 flex flex-col gap-3">
          {Array.from({ length: 8 }, (_, i) => <div key={i}>{bloque(`${96 - (i % 3) * 6}%`, 14)}</div>)}
        </div>
      </div>
    </div>
  );
}
