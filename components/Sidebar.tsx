"use client";

import { useEffect, useRef, useState } from "react";
import { activarModoConsulta } from "../lib/modo-consulta";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { limpiarMemoriaCache } from "../lib/cache-sistema";
import { LOGO_MENU, NOMBRE_INSTITUCION, NOMBRE_SISTEMA, NOMBRE_MARCA, FUENTE_MARCA } from "../lib/marca";

/**
 * Menú lateral (propuesta D): fondo blanco, texto casi negro, íconos de un solo trazo y la
 * sección activa en verde institucional (#005A28) con letra blanca. Bajo el nombre, la línea dorada.
 */

type IconoNombre =
  | "inicio" | "balance" | "resultados" | "flujo" | "indicadores"
  | "inversiones" | "fondos" | "cartera" | "cuentasCobrar" | "activoFijo" | "otrosActivos"
  | "captaciones" | "pasivo" | "cuentasPagar" | "obligaciones" | "otrosPasivos" | "patrimonio"
  | "ingresos" | "egresos"
  | "carga" | "catalogo"
  | "llave" | "salir" | "usuarios" | "bitacora" | "control" | "metas" | "ejecucion";

interface NavItem { href: string; label: string; icono: IconoNombre; }

const MODULOS: NavItem[] = [
  { href: "/inicio", label: "Inicio", icono: "inicio" },
  { href: "/balance-general", label: "Balance general", icono: "balance" },
  { href: "/estado-resultados", label: "Estado de resultados", icono: "resultados" },
  { href: "/flujo-efectivo", label: "Flujo de efectivo", icono: "flujo" },
  { href: "/indicadores", label: "Indicadores", icono: "indicadores" },
  { href: "/planificacion", label: "Planificación", icono: "inversiones" },
  { href: "/metas-agencia", label: "Metas por agencia", icono: "metas" },
  { href: "/ejecucion", label: "Ejecución presupuestaria", icono: "ejecucion" },
];

const ACTIVOS: NavItem[] = [
  { href: "/fondos-disponibles", label: "Fondos disponibles", icono: "fondos" },
  { href: "/inversiones", label: "Inversiones", icono: "inversiones" },
  { href: "/cartera", label: "Cartera de crédito", icono: "cartera" },
  { href: "/cuentas-por-cobrar", label: "Cuentas por cobrar", icono: "cuentasCobrar" },
  { href: "/activos-fijos", label: "Activos fijos", icono: "activoFijo" },
  { href: "/otros-activos", label: "Otros activos", icono: "otrosActivos" },
];

const PASIVOS: NavItem[] = [
  { href: "/captaciones", label: "Obligaciones con el público", icono: "captaciones" },
  { href: "/cuentas-por-pagar", label: "Cuentas por pagar", icono: "cuentasPagar" },
  { href: "/obligaciones-financieras", label: "Obligaciones financieras", icono: "obligaciones" },
  { href: "/otros-pasivos", label: "Otros pasivos", icono: "otrosPasivos" },
];

const PATRIMONIO: NavItem[] = [
  { href: "/patrimonio", label: "Patrimonio", icono: "patrimonio" },
];

const INGRESOS: NavItem[] = [
  { href: "/proyeccion-ingresos", label: "Proyección de ingresos", icono: "ingresos" },
];

const EGRESOS: NavItem[] = [
  { href: "/intereses-causados", label: "Intereses causados", icono: "captaciones" },
  { href: "/provisiones", label: "Provisiones", icono: "cartera" },
  { href: "/proyeccion-egresos", label: "Gastos operacionales", icono: "egresos" },
  { href: "/otros-gastos", label: "Otros gastos", icono: "resultados" },
];

const CAMBIAR_CONTRASENA = "/cuenta/contrasena";

const USUARIOS: NavItem = { href: "/administracion/usuarios", label: "Usuarios", icono: "usuarios" };
const PARAMETROS: NavItem = { href: "/administracion/parametros", label: "Parámetros institucionales", icono: "catalogo" };
const BITACORA: NavItem = { href: "/administracion/bitacora", label: "Bitácora", icono: "bitacora" };

const ADMINISTRACION: NavItem[] = [
  { href: "/carga-datos", label: "Carga de datos", icono: "carga" },
  { href: "/catalogo-cuentas", label: "Catálogo de cuentas", icono: "catalogo" },
  { href: "/administracion/integridad", label: "Control de integridad", icono: "control" },
];

// Íconos de línea, 18 px, todos del mismo trazo; toman el color del texto.
function Icono({ nombre }: { nombre: IconoNombre }) {
  const trazos: Record<IconoNombre, React.ReactNode> = {
    inicio: (<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
    balance: (<><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="m3 13 9 5 9-5" /></>),
    resultados: (<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>),
    indicadores: (<><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-5" /><path d="M8 18h8" /></>),
    flujo: (<><path d="M4 7h15" /><path d="m15 3 4 4-4 4" /><path d="M20 17H5" /><path d="m9 13-4 4 4 4" /></>),
    fondos: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
    inversiones: (<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>),
    cartera: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>),
    cuentasCobrar: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M12 7v8" /><path d="M14.5 8.5h-3.25a1.75 1.75 0 0 0 0 3.5h1.5a1.75 1.75 0 0 1 0 3.5H9.5" /></>),
    activoFijo: (<><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /><path d="M3 21h18" /></>),
    otrosActivos: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>),
    captaciones: (<><path d="M19 8V6a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7" /><path d="M16 14h.01" /></>),
    pasivo: (<><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" /></>),
    cuentasPagar: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h4" /><path d="m13 15 2 2 3-3" /></>),
    obligaciones: (<><path d="M3 21h18" /><path d="M4 10h16" /><path d="M12 3 4 7v3h16V7z" /><path d="M7 10v8M12 10v8M17 10v8" /></>),
    otrosPasivos: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 15h8" /></>),
    patrimonio: (<><path d="M3 10 12 4l9 6" /><path d="M5 10v8" /><path d="M10 10v8" /><path d="M14 10v8" /><path d="M19 10v8" /><path d="M3 21h18" /></>),
    ingresos: (<><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>),
    egresos: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></>),
    carga: (<><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>),
    catalogo: (<><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" /><path d="M4 17a3 3 0 0 1 3-3h12" /></>),
    llave: (<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3" /><path d="m16 7 3 3" /><path d="m19 4 2 2" /></>),
    usuarios: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18.5 14.5A6.5 6.5 0 0 1 21.5 20" /></>),
    ejecucion: (<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M3 20h18" /><path d="m14 8 3-3 3 3" /></>),
    metas: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" /></>),
    control: (<><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>),
    bitacora: (<><path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z" /><path d="M10 8h6" /><path d="M10 12h6" /><path d="M10 16h4" /></>),
    salir: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {trazos[nombre]}
    </svg>
  );
}

function IconoChevron({ abierto }: { abierto: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         className={`text-[#26302B] transition-transform duration-150 ${abierto ? "rotate-0" : "-rotate-90"}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function NavGroup({
  title, items, pathname, defaultAbierto = false, pendiente, onElegir, contraido = false,
}: { title: string; items: NavItem[]; pathname: string; defaultAbierto?: boolean; pendiente: string | null; onElegir: (href: string) => void; contraido?: boolean }) {
  const contieneActiva = items.some((item) => item.href === (pendiente ?? pathname));
  const [abiertoManual, setAbiertoManual] = useState<boolean | null>(null);
  const abierto = abiertoManual !== null ? abiertoManual : (contieneActiva || defaultAbierto);

  // Menú contraído: solo íconos (con su nombre al pasar el ratón), todos visibles, grupos separados por una línea
  if (contraido) {
    return (
      <div className="py-1.5 border-b border-[#EEF0EE] last:border-0 flex flex-col gap-0.5" aria-label={title} role="group">
        {items.map((item) => {
          const activo = (pendiente ?? pathname) === item.href;
          return (
            <Link key={item.href} href={item.href} title={item.label} aria-label={item.label}
                  onClick={() => { if (item.href !== pathname) onElegir(item.href); }}
                  aria-current={activo ? "page" : undefined}
                  className={`mx-2 flex items-center justify-center h-9 rounded-lg transition-colors ${activo ? "bg-[#005A28] text-white" : "text-[#0B0F0D] hover:bg-[#EEF3EF]"}`}>
              <Icono nombre={item.icono} />
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => setAbiertoManual(!abierto)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between px-6 pt-3 pb-2 hover:text-[#111418]"
      >
        <span className="text-[10px] font-bold tracking-[0.06em] text-[#26302B]">{title.toUpperCase()}</span>
        <IconoChevron abierto={abierto} />
      </button>
      {abierto && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            // Al hacer clic, la opción se marca al instante (no espera a que la sección termine de abrir)
            const activo = (pendiente ?? pathname) === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => { if (item.href !== pathname) onElegir(item.href); }}
                aria-current={activo ? "page" : undefined}
                className={`mx-2.5 flex items-center gap-3 min-h-10 py-1.5 px-3 rounded-lg text-[13px] transition-colors ${
                  activo
                    ? "bg-[#005A28] text-white font-semibold"
                    : "text-[#0B0F0D] hover:bg-[#EEF3EF]"
                }`}
              >
                <Icono nombre={item.icono} />
                <span className="leading-snug">{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function iniciales(texto: string): string {
  const partes = texto.trim().split(/[\s._-]+/).filter(Boolean);
  return (partes.length >= 2 ? partes[0][0] + partes[1][0] : texto.slice(0, 2)).toUpperCase();
}

const TODAS = [...MODULOS, ...ACTIVOS, ...PASIVOS, ...PATRIMONIO, ...EGRESOS, ...INGRESOS, ...ADMINISTRACION].map((i) => i.href);

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [pendiente, setPendiente] = useState<string | null>(null);
  useEffect(() => { setPendiente(null); }, [pathname]);

  // Usuario con sesión iniciada (tarjeta al pie del menú)
  const [usuario, setUsuario] = useState<{ nombre: string; usuario: string } | null>(null);
  const [menuCuenta, setMenuCuenta] = useState(false);
  const refCuenta = useRef<HTMLDivElement>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [perfil, setPerfil] = useState<string>("");
  const [saliendo, setSaliendo] = useState(false);
  const enLogin = pathname === "/login";
  // Menú contraído (solo íconos): deja más espacio a las tablas de 12 meses. Se recuerda en este navegador.
  const [contraido, setContraido] = useState(false);
  useEffect(() => {
    // Sin preferencia guardada: en pantallas de menos de 1440 px empieza contraído (las tablas de 12 meses no caben)
    let guardado: string | null = null;
    try { guardado = localStorage.getItem("menu-contraido"); } catch { /* sin almacenamiento */ }
    setContraido(guardado !== null ? guardado === "1" : window.innerWidth < 1440);
  }, []);
  const alternarMenu = () => setContraido((c) => {
    try { localStorage.setItem("menu-contraido", c ? "0" : "1"); } catch { /* sin almacenamiento */ }
    return !c;
  });
  useEffect(() => {
    if (enLogin) return;
    fetch("/api/auth/sesion")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setUsuario(d ? { nombre: d.nombre || d.usuario, usuario: d.usuario } : null); setEsAdmin(d?.es_admin === true);
        setPerfil(d?.rol === "consulta" ? "Consulta" : d?.es_admin ? "Administrador" : d ? "Edición" : "");
        if (d?.rol === "consulta") activarModoConsulta(); })
      .catch(() => undefined);
  }, [enLogin]);

  // El menú de la cuenta se cierra al hacer clic fuera, con Escape o al cambiar de pantalla
  useEffect(() => { setMenuCuenta(false); }, [pathname]);
  useEffect(() => {
    if (!menuCuenta) return;
    const fuera = (e: MouseEvent) => { if (!refCuenta.current?.contains(e.target as Node)) setMenuCuenta(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuCuenta(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", tecla); };
  }, [menuCuenta]);

  async function cerrarSesion() {
    setSaliendo(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* igual se sale */ }
    // Borra los datos guardados en este navegador, para que no queden en equipos compartidos
    limpiarMemoriaCache();
    window.location.href = "/login";
  }

  // Deja listas las secciones por adelantado, SOLO en la versión publicada y de a una, con pausa:
  // el navegador descarga la pantalla ya compilada (no lee la base de datos).
  // En la vista previa de AI Studio no se hace nada: allí cada pedido obliga al servidor a compilar
  // y pedir todas las secciones juntas provocaba "Rate exceeded" y pantallas sin estilos.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || window.location.pathname === "/login") return;
    let cancelado = false;
    const t = setTimeout(async () => {
      for (const href of TODAS) {
        if (cancelado) return;
        if (href === pathname) continue;
        try { router.prefetch(href); } catch { /* ignorar */ }
        await new Promise((r) => setTimeout(r, 400));
      }
    }, 3000);
    return () => { cancelado = true; clearTimeout(t); };
    // Solo al abrir la herramienta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (enLogin) return null;

  return (
    <aside className={`estilo-institucional ${contraido ? "w-[60px]" : "w-[216px]"} shrink-0 bg-white border-r border-[#E3E6E4] h-screen sticky top-0 overflow-y-auto overflow-x-hidden py-5 flex flex-col transition-[width] duration-150`}>
      <div className={`flex flex-col ${contraido ? "px-2 items-center" : "px-4"} pb-4 mb-1.5 border-b border-[#EEF0EE]`}>
        {/* Marca sobria: logo │ nombre con serifa y sistema en gris */}
        <div className="flex items-center gap-2.5" title={`${NOMBRE_INSTITUCION} · ${NOMBRE_SISTEMA}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_MENU} alt={NOMBRE_INSTITUCION} width={32} height={27} className="w-[32px] h-auto shrink-0" />
          {!contraido && <span className="self-stretch w-px bg-[#D5DBD7]" aria-hidden="true" />}
          {!contraido && <div className="min-w-0 flex flex-col">
            <span className="text-[16.5px] font-semibold text-[#111418] leading-tight whitespace-nowrap" style={{ fontFamily: FUENTE_MARCA }}>{NOMBRE_MARCA}</span>
            <span className="text-[10.5px] font-medium text-[#4A554F] leading-tight mt-1 whitespace-nowrap">{NOMBRE_SISTEMA}</span>
          </div>}
        </div>
        <button type="button" onClick={alternarMenu} aria-label={contraido ? "Expandir menú" : "Contraer menú"} title={contraido ? "Expandir menú" : "Contraer menú"}
                className={`mt-3 h-7 rounded-md text-[#4A554F] hover:bg-[#EEF3EF] flex items-center justify-center text-[14px] ${contraido ? "w-9" : "self-end w-7"}`}>
          {contraido ? "»" : "«"}
        </button>
      </div>

      <nav aria-label="Navegación principal" className="flex-1">
        <NavGroup title="Módulos" items={MODULOS} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} defaultAbierto contraido={contraido} />
        <NavGroup title="Activos" items={ACTIVOS} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
        <NavGroup title="Pasivos" items={PASIVOS} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
        <NavGroup title="Patrimonio" items={PATRIMONIO} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
        {/* En el orden del catálogo: 4 Egresos (gastos) antes que 5 Ingresos */}
        <NavGroup title="Egresos" items={EGRESOS} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
        <NavGroup title="Ingresos" items={INGRESOS} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
        <NavGroup title="Administración" items={esAdmin ? [...ADMINISTRACION, PARAMETROS, USUARIOS, BITACORA] : ADMINISTRACION} pathname={pathname} pendiente={pendiente} onElegir={setPendiente} contraido={contraido} />
      </nav>

      {/* Cuenta: tarjeta compacta; al hacer clic muestra Cambiar contraseña y Cerrar sesión */}
      <div ref={refCuenta} className={`relative mt-3 ${contraido ? "px-1.5" : "px-2.5"} pt-3 border-t border-[#EEF0EE]`}>
        {menuCuenta && (
          <div role="menu" className={`absolute ${contraido ? "left-1.5 w-52" : "left-2.5 right-2.5"} bottom-full mb-1.5 bg-white border border-[#E3E6E4] rounded-xl shadow-[0_8px_24px_rgba(17,20,24,0.12)] p-1.5 z-10`}>
            <Link
              href={CAMBIAR_CONTRASENA}
              role="menuitem"
              className="flex items-center gap-3 h-10 px-3 rounded-lg text-[13px] text-[#0B0F0D] hover:bg-[#EEF3EF]"
            >
              <Icono nombre="llave" />
              Cambiar contraseña
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={cerrarSesion}
              disabled={saliendo}
              className="w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[13px] text-[#9B1C1C] hover:bg-[#FDECEC] disabled:opacity-60"
            >
              <Icono nombre="salir" />
              {saliendo ? "Cerrando sesión…" : "Cerrar sesión"}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuCuenta(!menuCuenta)}
          aria-haspopup="menu"
          aria-expanded={menuCuenta}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
            menuCuenta || pathname === CAMBIAR_CONTRASENA ? "bg-[#EEF3EF]" : "hover:bg-[#F4F6F5]"
          }`}
        >
          <span className="w-8 h-8 rounded-full bg-[#005A28] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {usuario ? iniciales(usuario.nombre) : ""}
          </span>
{!contraido && <>          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-[#111418] truncate">{usuario?.nombre ?? "\u00a0"}</span>
            <span className="block text-[11px] text-[#6B7570] truncate">{perfil || "\u00a0"}</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               aria-hidden="true" className={`shrink-0 text-[#6B7570] transition-transform ${menuCuenta ? "" : "rotate-180"}`}>
            <path d="m6 9 6 6 6-6" />
          </svg></>}
        </button>
      </div>
    </aside>
  );
}
