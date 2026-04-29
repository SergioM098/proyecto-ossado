import type { Connection } from "./db.js";
import {
  getTables,
  getColumns,
  getCreateTableDDL,
  getProcedures,
  getCreateProcedureDDL,
} from "./schema.js";
import type { ColumnInfo } from "./schema.js";

export const BILLING_STRUCTURE_TABLES = [
  "estructura_json_fe_cab",
  "estructura_json_fe_cue",
  "estructura_json_fe_employee",
  "estructura_json_fe_ptovta",
  "estructura_json_fe_ref",
  "estructura_json_fe_taxes_cab",
  "estructura_json_fe_taxes_cue",
  "estructura_json_ne_accruals",
  "estructura_json_ne_cab",
  "estructura_json_ne_deductions",
  "estructura_json_ne_employer",
  "estructura_json_ne_notes",
  "estructura_json_ne_numero",
];

export const BILLING_STRUCTURE_PROCEDURES = ["sp_genera_estructura"];

export interface SyncResult {
  tablesCreated: string[];
  columnsAdded: { table: string; column: string }[];
  errors: { action: string; error: string }[];
}

export interface BillingStructureSyncResult extends SyncResult {
  proceduresCreated: string[];
  proceduresSkipped: string[];
}

export function findMissingTables(
  db1Tables: string[],
  db2Tables: string[]
): string[] {
  const db1Set = new Set(db1Tables.map((t) => t.toLowerCase()));
  return db2Tables.filter((t) => !db1Set.has(t.toLowerCase()));
}

export function findMissingColumns(
  db1Columns: ColumnInfo[],
  db2Columns: ColumnInfo[]
): ColumnInfo[] {
  const db1Set = new Set(db1Columns.map((c) => c.name.toLowerCase()));
  return db2Columns.filter((c) => !db1Set.has(c.name.toLowerCase()));
}

function buildColumnDefinition(col: ColumnInfo): string {
  let def = `\`${col.name}\` ${col.columnType}`;

  if (col.isNullable === "NO") {
    def += " NOT NULL";
  } else {
    def += " NULL";
  }

  if (col.columnDefault !== null) {
    if (
      col.columnDefault === "CURRENT_TIMESTAMP" ||
      col.columnDefault.startsWith("CURRENT_TIMESTAMP")
    ) {
      def += ` DEFAULT ${col.columnDefault}`;
    } else {
      def += ` DEFAULT '${col.columnDefault}'`;
    }
  }

  if (col.extra) {
    def += ` ${col.extra}`;
  }

  return def;
}

export async function createMissingTables(
  db1Conn: Connection,
  db2Conn: Connection,
  missingTables: string[]
): Promise<SyncResult> {
  const result: SyncResult = {
    tablesCreated: [],
    columnsAdded: [],
    errors: [],
  };

  for (const table of missingTables) {
    try {
      console.log(`\n  [CREATE TABLE] Creando tabla: ${table}`);
      const ddl = await getCreateTableDDL(db2Conn, table);
      await db1Conn.query(ddl);
      result.tablesCreated.push(table);
      console.log(`  [OK] Tabla '${table}' creada exitosamente`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] No se pudo crear tabla '${table}': ${errorMsg}`);
      result.errors.push({
        action: `CREATE TABLE ${table}`,
        error: errorMsg,
      });
    }
  }

  return result;
}

function mapNamesByLowerCase(names: string[]): Map<string, string> {
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

export async function addMissingColumns(
  db1Conn: Connection,
  db2Conn: Connection,
  tableName: string
): Promise<SyncResult> {
  const result: SyncResult = {
    tablesCreated: [],
    columnsAdded: [],
    errors: [],
  };

  const db1Columns = await getColumns(db1Conn, tableName);
  const db2Columns = await getColumns(db2Conn, tableName);
  const missing = findMissingColumns(db1Columns, db2Columns);

  if (missing.length === 0) {
    return result;
  }

  for (const col of missing) {
    try {
      const colDef = buildColumnDefinition(col);
      let sql = `ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}`;

      // Posicionar la columna después de la columna anterior en DB2
      if (col.afterColumn) {
        sql += ` AFTER \`${col.afterColumn}\``;
      } else {
        sql += " FIRST";
      }

      console.log(`  [ADD COLUMN] ${tableName}.${col.name} (${col.columnType})`);
      await db1Conn.query(sql);
      result.columnsAdded.push({ table: tableName, column: col.name });
      console.log(`  [OK] Columna '${col.name}' agregada a '${tableName}'`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [ERROR] No se pudo agregar columna '${col.name}' a '${tableName}': ${errorMsg}`
      );
      result.errors.push({
        action: `ALTER TABLE ${tableName} ADD COLUMN ${col.name}`,
        error: errorMsg,
      });
    }
  }

  return result;
}

export async function syncSchemas(
  db1Conn: Connection,
  db2Conn: Connection
): Promise<SyncResult> {
  const finalResult: SyncResult = {
    tablesCreated: [],
    columnsAdded: [],
    errors: [],
  };

  console.log("=== Obteniendo tablas de ambas bases de datos ===");
  const db1Tables = await getTables(db1Conn);
  const db2Tables = await getTables(db2Conn);

  console.log(`  DB1 (target): ${db1Tables.length} tablas`);
  console.log(`  DB2 (source): ${db2Tables.length} tablas`);

  // 1. Crear tablas faltantes
  const missingTables = findMissingTables(db1Tables, db2Tables);
  console.log(`\n=== Tablas faltantes en DB1: ${missingTables.length} ===`);

  if (missingTables.length > 0) {
    const createResult = await createMissingTables(
      db1Conn,
      db2Conn,
      missingTables
    );
    finalResult.tablesCreated.push(...createResult.tablesCreated);
    finalResult.errors.push(...createResult.errors);
  }

  // 2. Comparar columnas en tablas existentes en ambas DBs
  const db1Set = new Set(db1Tables.map((t) => t.toLowerCase()));
  const commonTables = db2Tables.filter((t) => db1Set.has(t.toLowerCase()));
  console.log(
    `\n=== Comparando columnas en ${commonTables.length} tablas comunes ===`
  );

  for (const table of commonTables) {
    const colResult = await addMissingColumns(db1Conn, db2Conn, table);
    finalResult.columnsAdded.push(...colResult.columnsAdded);
    finalResult.errors.push(...colResult.errors);
  }

  return finalResult;
}

export async function createMissingProcedures(
  db1Conn: Connection,
  db2Conn: Connection,
  procedureNames: string[]
): Promise<Pick<BillingStructureSyncResult, "proceduresCreated" | "proceduresSkipped" | "errors">> {
  const result = {
    proceduresCreated: [] as string[],
    proceduresSkipped: [] as string[],
    errors: [] as { action: string; error: string }[],
  };

  const db1Procedures = mapNamesByLowerCase(await getProcedures(db1Conn));
  const db2Procedures = mapNamesByLowerCase(await getProcedures(db2Conn));

  for (const procedureName of procedureNames) {
    const sourceProcedureName = db2Procedures.get(procedureName.toLowerCase());

    if (!sourceProcedureName) {
      const error = "No existe en DB2 (source)";
      console.log(`  [ERROR] Procedimiento '${procedureName}': ${error}`);
      result.errors.push({
        action: `CREATE PROCEDURE ${procedureName}`,
        error,
      });
      continue;
    }

    if (db1Procedures.has(procedureName.toLowerCase())) {
      console.log(`  [SKIP] Procedimiento ya existe: ${procedureName}`);
      result.proceduresSkipped.push(procedureName);
      continue;
    }

    try {
      console.log(`  [CREATE PROCEDURE] Creando procedimiento: ${sourceProcedureName}`);
      const ddl = await getCreateProcedureDDL(db2Conn, sourceProcedureName);
      await db1Conn.query(ddl);
      result.proceduresCreated.push(sourceProcedureName);
      console.log(`  [OK] Procedimiento '${sourceProcedureName}' creado exitosamente`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [ERROR] No se pudo crear procedimiento '${sourceProcedureName}': ${errorMsg}`
      );
      result.errors.push({
        action: `CREATE PROCEDURE ${sourceProcedureName}`,
        error: errorMsg,
      });
    }
  }

  return result;
}

export async function syncBillingStructure(
  db1Conn: Connection,
  db2Conn: Connection
): Promise<BillingStructureSyncResult> {
  const finalResult: BillingStructureSyncResult = {
    tablesCreated: [],
    columnsAdded: [],
    proceduresCreated: [],
    proceduresSkipped: [],
    errors: [],
  };

  console.log("=== Obteniendo tablas de ambas bases de datos ===");
  const db1Tables = await getTables(db1Conn);
  const db2Tables = await getTables(db2Conn);
  const db1TablesByLower = mapNamesByLowerCase(db1Tables);
  const db2TablesByLower = mapNamesByLowerCase(db2Tables);

  console.log(`  DB1 (target): ${db1Tables.length} tablas`);
  console.log(`  DB2 (source): ${db2Tables.length} tablas`);
  console.log(`  Tablas de facturacion solicitadas: ${BILLING_STRUCTURE_TABLES.length}`);

  const missingTables: string[] = [];
  const commonTables: string[] = [];

  for (const table of BILLING_STRUCTURE_TABLES) {
    const sourceTable = db2TablesByLower.get(table.toLowerCase());

    if (!sourceTable) {
      const error = "No existe en DB2 (source)";
      console.log(`  [ERROR] Tabla '${table}': ${error}`);
      finalResult.errors.push({
        action: `CREATE TABLE ${table}`,
        error,
      });
      continue;
    }

    if (db1TablesByLower.has(table.toLowerCase())) {
      commonTables.push(sourceTable);
    } else {
      missingTables.push(sourceTable);
    }
  }

  console.log(`\n=== Tablas de facturacion faltantes en DB1: ${missingTables.length} ===`);
  if (missingTables.length > 0) {
    const createResult = await createMissingTables(db1Conn, db2Conn, missingTables);
    finalResult.tablesCreated.push(...createResult.tablesCreated);
    finalResult.errors.push(...createResult.errors);
  }

  console.log(
    `\n=== Comparando columnas en ${commonTables.length} tablas de facturacion existentes ===`
  );
  for (const table of commonTables) {
    const colResult = await addMissingColumns(db1Conn, db2Conn, table);
    finalResult.columnsAdded.push(...colResult.columnsAdded);
    finalResult.errors.push(...colResult.errors);
  }

  console.log(
    `\n=== Agregando procedimientos de facturacion: ${BILLING_STRUCTURE_PROCEDURES.length} ===`
  );
  const procedureResult = await createMissingProcedures(
    db1Conn,
    db2Conn,
    BILLING_STRUCTURE_PROCEDURES
  );
  finalResult.proceduresCreated.push(...procedureResult.proceduresCreated);
  finalResult.proceduresSkipped.push(...procedureResult.proceduresSkipped);
  finalResult.errors.push(...procedureResult.errors);

  return finalResult;
}
