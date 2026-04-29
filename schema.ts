import type mysql from "mysql2/promise";
import type { Connection } from "./db.js";

export interface ColumnInfo {
  name: string;
  ordinalPosition: number;
  columnDefault: string | null;
  isNullable: string;
  columnType: string;
  extra: string;
  afterColumn: string | null;
}

export async function getTables(conn: Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  return (rows as Array<{ TABLE_NAME: string }>).map((r) => r.TABLE_NAME);
}

export async function getProcedures(conn: Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ROUTINE_NAME
     FROM INFORMATION_SCHEMA.ROUTINES
     WHERE ROUTINE_SCHEMA = DATABASE()
       AND ROUTINE_TYPE = 'PROCEDURE'
     ORDER BY ROUTINE_NAME`
  );
  return (rows as Array<{ ROUTINE_NAME: string }>).map((r) => r.ROUTINE_NAME);
}

export async function getColumns(
  conn: Connection,
  tableName: string
): Promise<ColumnInfo[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT
       COLUMN_NAME,
       ORDINAL_POSITION,
       COLUMN_DEFAULT,
       IS_NULLABLE,
       COLUMN_TYPE,
       EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );

  const columns = rows as Array<{
    COLUMN_NAME: string;
    ORDINAL_POSITION: number;
    COLUMN_DEFAULT: string | null;
    IS_NULLABLE: string;
    COLUMN_TYPE: string;
    EXTRA: string;
  }>;

  return columns.map((col, index) => ({
    name: col.COLUMN_NAME,
    ordinalPosition: col.ORDINAL_POSITION,
    columnDefault: col.COLUMN_DEFAULT,
    isNullable: col.IS_NULLABLE,
    columnType: col.COLUMN_TYPE,
    extra: col.EXTRA,
    afterColumn: index > 0 ? columns[index - 1].COLUMN_NAME : null,
  }));
}

export async function getCreateTableDDL(
  conn: Connection,
  tableName: string
): Promise<string> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SHOW CREATE TABLE \`${tableName}\``
  );
  const result = rows as Array<{ "Create Table": string }>;
  return result[0]["Create Table"];
}

export async function getCreateProcedureDDL(
  conn: Connection,
  procedureName: string
): Promise<string> {
  const escapedProcedureName = procedureName.replace(/`/g, "``");
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SHOW CREATE PROCEDURE \`${escapedProcedureName}\``
  );
  const result = rows as Array<{ "Create Procedure": string }>;

  // Avoid requiring the original DEFINER user to exist in the target database.
  return result[0]["Create Procedure"].replace(
    /^CREATE\s+DEFINER=`[^`]*`@`[^`]*`\s+/i,
    "CREATE "
  );
}
