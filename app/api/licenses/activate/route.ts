import { NextResponse } from "next/server";
import { isAuthenticated } from "../../../../lib/auth";
import { activateLicense } from "../../../../lib/licenses";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const nit = typeof body?.nit === "string" ? body.nit : "";
  const hasta = typeof body?.hasta === "string" ? body.hasta : "";
  const nombre = typeof body?.nombre === "string" ? body.nombre : null;
  const connectionIds = Array.isArray(body?.connectionIds)
    ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (!nit || !hasta) {
    return NextResponse.json({ error: "Falta el NIT o la fecha" }, { status: 400 });
  }

  try {
    return NextResponse.json(await activateLicense(nit, nombre, hasta, connectionIds));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
