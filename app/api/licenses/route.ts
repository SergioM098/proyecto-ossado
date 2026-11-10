import { NextResponse } from "next/server";
import { isAuthenticated } from "../../../lib/auth";
import { listLicenses } from "../../../lib/licenses";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  try {
    return NextResponse.json({ licenses: await listLicenses() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
