import type { Connection } from "./db";
import {
  getTables,
  getColumns,
  getCreateTableDDL,
  getProcedures,
  getCreateProcedureDDL,
} from "./schema";
import type { ColumnInfo } from "./schema";

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
  "errores_fe_dian"
];

export const BILLING_STRUCTURE_PROCEDURES = [
  "sp_actualiza_fecfac",
  "sp_factura_con_referencia",
  "sp_factura_con_referencia_post",
  "sp_factura_ds",
  "sp_factura_sin_referencia",
  "sp_genera_estructura",
  "sp_nomina_ne",
  "sp_nomina_ne_cabeza",
  "sp_periodos_moconta"
];

export const GENERAL_PROCEDURES = [
  "terceros",
  "fuentes",
  "sucursal",
  "tipo_documento",
  "consecutivos",
  "sp_ccosto",
  "macuenta",
  "get_current_consecutives",
  "moconta",
];

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

export async function planSchemaSync(db1Conn: Connection, db2Conn: Connection) {
  const db1Tables = await getTables(db1Conn);
  const db2Tables = await getTables(db2Conn);
  const db1Set = new Set(db1Tables.map((t) => t.toLowerCase()));

  return {
    db1Count: db1Tables.length,
    db2Count: db2Tables.length,
    missingTables: findMissingTables(db1Tables, db2Tables),
    commonTables: db2Tables.filter((t) => db1Set.has(t.toLowerCase())),
  };
}

export async function planBillingStructure(db1Conn: Connection, db2Conn: Connection) {
  const db1Tables = await getTables(db1Conn);
  const db2Tables = await getTables(db2Conn);
  const db1TablesByLower = mapNamesByLowerCase(db1Tables);
  const db2TablesByLower = mapNamesByLowerCase(db2Tables);

  const missingTables: string[] = [];
  const commonTables: string[] = [];
  const errors: { action: string; error: string }[] = [];

  for (const table of BILLING_STRUCTURE_TABLES) {
    const sourceTable = db2TablesByLower.get(table.toLowerCase());

    if (!sourceTable) {
      errors.push({ action: `CREATE TABLE ${table}`, error: "No existe en DB2 (source)" });
      continue;
    }

    if (db1TablesByLower.has(table.toLowerCase())) {
      commonTables.push(sourceTable);
    } else {
      missingTables.push(sourceTable);
    }
  }

  return {
    db1Count: db1Tables.length,
    db2Count: db2Tables.length,
    missingTables,
    commonTables,
    errors,
  };
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
