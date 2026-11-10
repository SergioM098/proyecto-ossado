import { NextResponse } from "next/server";
import { isAuthenticated } from "../../../../lib/auth";
import { findCompanies, previewCompany } from "../../../../lib/licenses";

export const runtime = "nodejs";
export const maxDuration = 60;

// Busca por NIT las bases de la empresa y lee los valores actuales, sin escribir nada
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const nit = typeof body?.nit === "string" ? body.nit : "";
  if (!nit) {
    return NextResponse.json({ error: "Falta el NIT" }, { status: 400 });
  }

  try {
    const { matches, serverErrors } = await findCompanies(nit);
    const companies = await Promise.all(
      matches.map((m) =>
        previewCompany(m).catch((err) => ({
          connection: m,
          changes: [],
          error: err instanceof Error ? err.message : String(err),
        }))
      )
    );
    return NextResponse.json({ companies, serverErrors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
