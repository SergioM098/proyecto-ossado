import { NextResponse } from "next/server";
import { isAuthenticated } from "../../../lib/auth";
import { executeStep, type StepRequest } from "../../../lib/steps";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_STEPS = new Set([
  "schema-plan",
  "billing-plan",
  "create-tables",
  "add-columns",
  "replace-data",
  "create-procedures",
]);

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { targetId, sourceId, ...stepRequest } = body ?? {};

  if (typeof targetId !== "string" || typeof sourceId !== "string") {
    return NextResponse.json({ error: "Falta origen o destino" }, { status: 400 });
  }
  if (!VALID_STEPS.has(stepRequest.step)) {
    return NextResponse.json({ error: "Paso no valido" }, { status: 400 });
  }

  try {
    const result = await executeStep(targetId, sourceId, stepRequest as StepRequest);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
