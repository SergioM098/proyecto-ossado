import type { Connection } from "./db";

// Tablas cuya data se reemplazará desde DB2 → DB1
export const DATA_SYNC_TABLES = [
  "opcion01",
  "opcion01p",
  "opcion02",
  "opcion03",
  "opcion04",
  "opcion05",
  "opcion06",
  "opcion07",
  "opcion08",
  "opcion09",
  "opcion10",
  "opcion11",
  "opcionad",
  "opciondr",
  "opcionec",
  "opcioneds",
  "opcionfc",
  "opcionld",
  "opcionlib",
  "opcionmd",
  "opcionmk",
  "opcionmn",
  "opcionnif",
  "opciono",
  "opcionos",
  "opcionpb",
  "opcionrp",
  "opciont",
  "opciontr",
  "formas",
  "monedas",
  "ciudades",
  "paises_fe",
];

// Tablas cuya data se reemplaza como parte de la sincronizacion de esquemas (opcion 1)
export const SCHEMA_SYNC_DATA_TABLES = [
  "concepto_recaudo",
  "ips_cobertura",
  "ips_modalidad_pago",
  "tipo_operacion",
  "paises_fe",
];

async function getTableRows(
  conn: Connection,
  tableName: string
): Promise<Record<string, unknown>[]> {
  const [rows] = await conn.query(`SELECT * FROM \`${tableName}\``);
  return rows as Record<string, unknown>[];
}

export async function replaceTableData(
  db1Conn: Connection,
  db2Conn: Connection,
  tableName: string
): Promise<number> {
  // Leer datos de DB2 (source)
  const rows = await getTableRows(db2Conn, tableName);

  // Vaciar tabla en DB1 (target)
  await db1Conn.query(`DELETE FROM \`${tableName}\``);

  if (rows.length === 0) {
    return 0;
  }

  // Insertar datos en lotes de 500 filas
  const batchSize = 500;
  const columns = Object.keys(rows[0]);
  const columnList = columns.map((c) => `\`${c}\``).join(", ");

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const placeholders = batch
      .map(() => `(${columns.map(() => "?").join(", ")})`)
      .join(", ");
    const values = batch.flatMap((row) =>
      columns.map((col) => row[col] ?? null)
    );

    await db1Conn.query(
      `INSERT INTO \`${tableName}\` (${columnList}) VALUES ${placeholders}`,
      values
    );
  }

  return rows.length;
}
