import { NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { listarAgencias } from "../../../lib/agencias";

export async function GET() {
  try {
    const db = getDb();
    const agencias = await listarAgencias(db);
    return NextResponse.json({ agencias });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo agencias" }, { status: 500 });
  }
}