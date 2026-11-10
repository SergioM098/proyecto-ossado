import { closeConnection, createConnection, type Connection } from "../db";
import { DATA_SYNC_TABLES, SCHEMA_SYNC_DATA_TABLES, replaceTableData } from "../dataSync";
import {
  BILLING_STRUCTURE_PROCEDURES,
  GENERAL_PROCEDURES,
  addMissingColumns,
  createMissingProcedures,
  createMissingTables,
  planBillingStructure,
  planSchemaSync,
} from "../sync";
import { getConnectionById } from "./connections";

// Cada paso es corto a proposito: el navegador los va encadenando,
// asi ninguna peticion se acerca al limite de duracion de Vercel.
export type StepRequest =
  | { step: "schema-plan" }
  | { step: "billing-plan" }
  | { step: "create-tables"; tables: string[] }
  | { step: "add-columns"; tables: string[] }
  | { step: "replace-data"; table: string }
  | { step: "create-procedures"; names: string[] };

async function runStep(target: Connection, source: Connection, req: StepRequest) {
  switch (req.step) {
    case "schema-plan":
      return planSchemaSync(target, source);

    case "billing-plan":
      return planBillingStructure(target, source);

    case "create-tables":
      return createMissingTables(target, source, req.tables);

    case "add-columns": {
      const columnsAdded: { table: string; column: string }[] = [];
      const errors: { action: string; error: string }[] = [];
      for (const table of req.tables) {
        try {
          const r = await addMissingColumns(target, source, table);
          columnsAdded.push(...r.columnsAdded);
          errors.push(...r.errors);
        } catch (err) {
          errors.push({
            action: `COMPARAR COLUMNAS ${table}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { columnsAdded, errors };
    }

    case "replace-data": {
      // Igual que la opcion 2 de consola: sin checks de FK mientras se reemplaza
      await target.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        const rows = await replaceTableData(target, source, req.table);
        return { table: req.table, rows };
      } finally {
        await target.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    }

    case "create-procedures":
      return createMissingProcedures(target, source, req.names);
  }
}

// Lo que llega del navegador no es confiable: solo se aceptan nombres simples
// y, para borrar data o crear procedimientos, solo los de las listas fijas.
const IDENTIFIER = /^[A-Za-z0-9_$]{1,64}$/;
const REPLACEABLE_TABLES = new Set<string>([...DATA_SYNC_TABLES, ...SCHEMA_SYNC_DATA_TABLES]);
const ALLOWED_PROCEDURES = new Set<string>([...BILLING_STRUCTURE_PROCEDURES, ...GENERAL_PROCEDURES]);

function checkNames(names: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(names) || names.length > 100) throw new Error("Lista no valida");
  for (const n of names) {
    if (typeof n !== "string" || !IDENTIFIER.test(n)) throw new Error(`Nombre no valido: ${String(n)}`);
    if (allowed && !allowed.has(n)) throw new Error(`'${n}' no esta permitido`);
  }
  return names as string[];
}

function validateRequest(req: StepRequest): StepRequest {
  switch (req.step) {
    case "create-tables":
    case "add-columns":
      return { step: req.step, tables: checkNames(req.tables) };
    case "replace-data":
      return { step: req.step, table: checkNames([req.table], REPLACEABLE_TABLES)[0] };
    case "create-procedures":
      return { step: req.step, names: checkNames(req.names, ALLOWED_PROCEDURES) };
    default:
      return { step: req.step };
  }
}

export async function executeStep(targetId: string, sourceId: string, rawReq: StepRequest) {
  if (targetId === sourceId) {
    throw new Error("Origen y destino no pueden ser la misma conexion");
  }
  const req = validateRequest(rawReq);

  const targetConfig = getConnectionById(targetId);
  const sourceConfig = getConnectionById(sourceId);

  let target: Connection | undefined;
  let source: Connection | undefined;
  try {
    target = await createConnection(targetConfig);
    source = await createConnection(sourceConfig);
    return await runStep(target, source, req);
  } finally {
    if (target) await closeConnection(target).catch(() => {});
    if (source) await closeConnection(source).catch(() => {});
  }
}
