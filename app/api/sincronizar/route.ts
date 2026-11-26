import { NextResponse } from "next/server";
import { getDb, marcarCambio, versionDatos } from "../../../lib/turso";

export async function POST() {
  try {
    const db = getDb();
    // Forzar incremento de version y limpieza de lecturas en el servidor
    await marcarCambio();
    const version = await versionDatos();

    // Obtener estadísticas de sincronización
    const [saldosRes, activosRes, agenciasRes] = await Promise.all([
      db.execute("SELECT COUNT(*) AS total FROM saldos_cargas").catch(() => ({ rows: [{ total: 0 }] })),
      db.execute("SELECT COUNT(*) AS total FROM activos_fijos_cargas").catch(() => ({ rows: [{ total: 0 }] })),
      db.execute("SELECT COUNT(*) AS total FROM agencias").catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    return NextResponse.json({
      ok: true,
      mensaje: "Base de datos sincronizada correctamente.",
      version,
      cargasSaldos: Number(saldosRes.rows[0]?.total ?? 0),
      cargasActivos: Number(activosRes.rows[0]?.total ?? 0),
      agencias: Number(agenciasRes.rows[0]?.total ?? 0),
      sincronizadoEn: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[api/sincronizar] Error al sincronizar base de datos:", error);
    return NextResponse.json(
      { error: "Error al sincronizar con la base de datos." },
      { status: 500 }
    );
  }
}

/** GET: solo consulta la versión actual (no escribe nada en la base). */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, version: await versionDatos() });
  } catch {
    return NextResponse.json({ error: "No se pudo leer la versión de los datos." }, { status: 500 });
  }
}