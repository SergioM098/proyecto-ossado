import { NextResponse } from "next/server";
import { DATA_SYNC_TABLES, SCHEMA_SYNC_DATA_TABLES } from "../../../dataSync";
import { BILLING_STRUCTURE_PROCEDURES, GENERAL_PROCEDURES } from "../../../sync";
import { isAuthenticated } from "../../../lib/auth";
import { discoverConnections } from "../../../lib/connections";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { connections, serverErrors } = await discoverConnections();
    return NextResponse.json({
      connections,
      serverErrors,
      lists: {
        dataSyncTables: DATA_SYNC_TABLES,
        schemaSyncDataTables: SCHEMA_SYNC_DATA_TABLES,
        billingProcedures: BILLING_STRUCTURE_PROCEDURES,
        generalProcedures: GENERAL_PROCEDURES,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
