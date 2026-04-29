import * as readline from "readline";
import { db1Config, db2Config } from "./config.js";
import { createConnection, closeConnection } from "./db.js";
import {
  syncSchemas,
  syncBillingStructure,
  BILLING_STRUCTURE_TABLES,
  BILLING_STRUCTURE_PROCEDURES,
} from "./sync.js";
import { syncData, DATA_SYNC_TABLES } from "./dataSync.js";

type DbConnection = Awaited<ReturnType<typeof createConnection>>;

function showBanner() {
  console.log("====================================================");
  console.log("   Sincronizador de Esquemas MySQL");
  console.log("====================================================");
  console.log();
  console.log(`  DB1 (target): ${db1Config.database} @ ${db1Config.host}:${db1Config.port}`);
  console.log(`  DB2 (source): ${db2Config.database} @ ${db2Config.host}:${db2Config.port}`);
  console.log();
}

function showMenu() {
  console.log("  Que desea hacer?\n");
  console.log("  1) Sincronizar esquemas (tablas y columnas faltantes)");
  console.log("  2) Reemplazar data de tablas de opciones y formas");
  console.log("  3) Ambos (sincronizar esquemas + reemplazar data)");
  console.log("  4) Agregar estructura de facturacion solamente");
  console.log("  5) Salir");
  console.log();
}

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runSchemaSync(db1Conn: DbConnection, db2Conn: DbConnection) {
  console.log("\n=== SINCRONIZACION DE ESQUEMAS ===\n");
  const result = await syncSchemas(db1Conn, db2Conn);

  console.log("\n--- Resumen Esquemas ---");
  console.log(`  Tablas creadas:     ${result.tablesCreated.length}`);
  if (result.tablesCreated.length > 0) {
    result.tablesCreated.forEach((t) => console.log(`    - ${t}`));
  }
  console.log(`  Columnas agregadas: ${result.columnsAdded.length}`);
  if (result.columnsAdded.length > 0) {
    result.columnsAdded.forEach((c) =>
      console.log(`    - ${c.table}.${c.column}`)
    );
  }
  if (result.errors.length > 0) {
    console.log(`  Errores:            ${result.errors.length}`);
    result.errors.forEach((e) =>
      console.log(`    - ${e.action}: ${e.error}`)
    );
  } else {
    console.log("  Errores:            0");
  }
}

async function runDataSync(db1Conn: DbConnection, db2Conn: DbConnection) {
  console.log("\n=== REEMPLAZO DE DATA ===");
  console.log(`  Tablas a reemplazar: ${DATA_SYNC_TABLES.length}`);
  console.log(`  (${DATA_SYNC_TABLES.join(", ")})\n`);

  const confirm = await askQuestion("  Confirma reemplazar la data? (s/n): ");
  if (confirm.toLowerCase() !== "s") {
    console.log("  Operacion cancelada.");
    return;
  }

  console.log();
  const result = await syncData(db1Conn, db2Conn);

  console.log("\n--- Resumen Data ---");
  console.log(`  Tablas reemplazadas: ${result.tablesReplaced.length}`);
  if (result.rowsCopied.length > 0) {
    result.rowsCopied.forEach((r) =>
      console.log(`    - ${r.table}: ${r.rows} filas`)
    );
  }
  if (result.errors.length > 0) {
    console.log(`  Errores:             ${result.errors.length}`);
    result.errors.forEach((e) =>
      console.log(`    - ${e.table}: ${e.error}`)
    );
  } else {
    console.log("  Errores:             0");
  }
}

async function runBillingStructureSync(db1Conn: DbConnection, db2Conn: DbConnection) {
  console.log("\n=== ESTRUCTURA DE FACTURACION ===");
  console.log(`  Tablas solicitadas: ${BILLING_STRUCTURE_TABLES.length}`);
  console.log(`  (${BILLING_STRUCTURE_TABLES.join(", ")})`);
  console.log(`  Procedimientos solicitados: ${BILLING_STRUCTURE_PROCEDURES.length}`);
  console.log(`  (${BILLING_STRUCTURE_PROCEDURES.join(", ")})\n`);

  const result = await syncBillingStructure(db1Conn, db2Conn);

  console.log("\n--- Resumen Facturacion ---");
  console.log(`  Tablas creadas:          ${result.tablesCreated.length}`);
  if (result.tablesCreated.length > 0) {
    result.tablesCreated.forEach((t) => console.log(`    - ${t}`));
  }
  console.log(`  Columnas agregadas:      ${result.columnsAdded.length}`);
  if (result.columnsAdded.length > 0) {
    result.columnsAdded.forEach((c) =>
      console.log(`    - ${c.table}.${c.column}`)
    );
  }
  console.log(`  Procedimientos creados:  ${result.proceduresCreated.length}`);
  if (result.proceduresCreated.length > 0) {
    result.proceduresCreated.forEach((p) => console.log(`    - ${p}`));
  }
  console.log(`  Procedimientos omitidos: ${result.proceduresSkipped.length}`);
  if (result.proceduresSkipped.length > 0) {
    result.proceduresSkipped.forEach((p) => console.log(`    - ${p}`));
  }
  if (result.errors.length > 0) {
    console.log(`  Errores:                 ${result.errors.length}`);
    result.errors.forEach((e) =>
      console.log(`    - ${e.action}: ${e.error}`)
    );
  } else {
    console.log("  Errores:                 0");
  }
}

async function main() {
  showBanner();
  showMenu();

  const option = await askQuestion("  Seleccione una opcion (1-5): ");

  if (option === "5") {
    console.log("\n  Hasta luego.");
    return;
  }

  if (!["1", "2", "3", "4"].includes(option)) {
    console.log("\n  Opcion no valida.");
    return;
  }

  let db1Conn;
  let db2Conn;

  try {
    console.log("\n=== Conectando a las bases de datos ===");
    db1Conn = await createConnection(db1Config);
    console.log("  [OK] Conectado a DB1 (target)");

    db2Conn = await createConnection(db2Config);
    console.log("  [OK] Conectado a DB2 (source)");

    if (option === "1" || option === "3") {
      await runSchemaSync(db1Conn, db2Conn);
    }

    if (option === "2" || option === "3") {
      await runDataSync(db1Conn, db2Conn);
    }

    if (option === "4") {
      await runBillingStructureSync(db1Conn, db2Conn);
    }

    console.log("\n  Proceso completado.");
  } catch (err) {
    console.error(
      "\n  [ERROR FATAL]",
      err instanceof Error ? err.message : err
    );
  } finally {
    if (db1Conn) await closeConnection(db1Conn);
    if (db2Conn) await closeConnection(db2Conn);
    console.log("  Conexiones cerradas.");
  }
}

main();
