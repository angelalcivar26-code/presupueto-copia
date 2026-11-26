import "dotenv/config";
import { readFileSync } from "node:fs";
import { getDb } from "../lib/turso";

async function main() {
  const db = getDb();
  const sqlCrudo = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf-8");

  // Se quitan los comentarios "-- ..." linea por linea ANTES de partir por ';',
  // porque un comentario que mencione un punto y coma (ej. "cuentas; DPF usa...")
  // rompia el statement siguiente si se dividia primero.
  const sql = sqlCrudo
    .split("\n")
    .map((linea) => linea.replace(/--.*$/, ""))
    .join("\n");

  // Turso/libsql no soporta multiples statements en una sola llamada;
  // se separan por ';' respetando que no haya ninguno dentro de un string.
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(statement);
  }

  console.log(`Listo: ${statements.length} sentencias DDL ejecutadas.`);

  // Semilla minima: las 10 agencias reales (mismos codigos que el
  // dashboard de indicadores, para poder cruzar datos mas adelante si hace falta).
  const agencias = [
    ["AG01", "Matriz", 1],
    ["AG02", "El Guabo", 0],
    ["AG03", "Piñas", 0],
    ["AG04", "Machala II", 0],
    ["AG05", "Ponce Enríquez", 0],
    ["AG06", "Balsas", 0],
    ["AG07", "Santa Rosa", 0],
    ["AG08", "Las Lajas", 0],
    ["AG09", "Naranjal", 0],
    ["AG10", "Catamayo", 0],
  ] as const;

  for (const [codigo, nombre, esMatriz] of agencias) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO agencias (codigo, nombre, es_matriz) VALUES (?, ?, ?)",
      args: [codigo, nombre, esMatriz],
    });
  }

  console.log("Listo: 10 agencias sembradas (Matriz marcada como validada).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
