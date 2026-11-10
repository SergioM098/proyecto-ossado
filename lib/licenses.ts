import mysql from "mysql2/promise";
import type { DbConfig } from "../db";
import { discoverConnections, getConnectionById, type PublicConnection } from "./connections";

// LICENSE_DB es un JSON con la conexion a la base de control de licencias:
// {"host":"1.2.3.4","port":3306,"user":"u","password":"p","database":"dbcontrol"}
function getLicenseDbConfig(): DbConfig {
  const raw = process.env.LICENSE_DB;
  if (!raw) throw new Error("Falta la variable de entorno LICENSE_DB");
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(raw);
  } catch {
    throw new Error("LICENSE_DB no es un JSON valido");
  }
  for (const key of ["host", "user", "password"]) {
    if (typeof c[key] !== "string" || !c[key]) throw new Error(`LICENSE_DB no tiene '${key}'`);
  }
  return {
    host: c.host as string,
    port: Number(c.port) || 3306,
    user: c.user as string,
    password: c.password as string,
    database: (c.database as string) || "dbcontrol",
  };
}

// dateStrings: las fechas llegan como "2026-06-30" y no se corren por zona horaria
async function connect(config: DbConfig) {
  return mysql.createConnection({ ...config, dateStrings: true, connectTimeout: 20000 });
}

async function withConnection<T>(config: DbConfig, fn: (c: mysql.Connection) => Promise<T>) {
  const conn = await connect(config);
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => {});
  }
}

function q(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

// "900.368.325-1" y "900368325" se consideran el mismo NIT
export function normalizeNit(nit: string | null | undefined): string {
  if (!nit) return "";
  const base = String(nit).split("-")[0];
  return base.replace(/\D/g, "");
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ---------- dbcontrol.licencia ----------

export interface LicenseRow {
  nit: string;
  nombre: string | null;
  desde: string | null;
  hasta: string | null;
}

export async function listLicenses(): Promise<LicenseRow[]> {
  return withConnection(getLicenseDbConfig(), async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT nit, nombre, desde, hasta
       FROM licencia
       ORDER BY nombre`
    );
    return rows as LicenseRow[];
  });
}

// ---------- tablas en la base de la empresa ----------

// Lo que se cambia en la base de cada empresa. "empresa" puede llamarse "empresas".
const COMPANY_CHANGES = [
  { tables: ["licencia"], column: "expira", name: "Vencimiento", value: (hasta: string) => hasta },
  { tables: ["empresa", "empresas"], column: "pasabordo", name: "Acceso", value: () => "*" },
  { tables: ["parafact"], column: "tasafija", name: "Facturación", value: () => "." },
] as const;

interface ResolvedChange {
  table: string;
  column: string;
}

// Busca tabla y columna sin importar mayusculas (en Linux los nombres de tabla las distinguen)
async function resolveChange(
  conn: mysql.Connection,
  database: string,
  change: (typeof COMPANY_CHANGES)[number]
): Promise<ResolvedChange> {
  const [tables] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES FROM ${q(database)}`);
  const tableNames = tables.map((r) => String(Object.values(r)[0]));

  for (const wanted of change.tables) {
    const table = tableNames.find((t) => t.toLowerCase() === wanted);
    if (!table) continue;
    const [columns] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM ${q(database)}.${q(table)}`
    );
    const column = columns.map((c) => String(c.Field)).find((f) => f.toLowerCase() === change.column);
    if (column) return { table, column };
  }
  throw new Error(`no tiene ${change.tables.join(" / ")}.${change.column}`); // solo para el log del servidor
}

export interface CompanyChangePreview {
  column: "expira" | "pasabordo" | "tasafija";
  label: string; // nombre amigable, sin revelar tablas ni columnas
  current: (string | null)[]; // valores actuales (primeras filas)
  rows: number;
  error?: string;
}

export interface CompanyPreview {
  connection: PublicConnection;
  changes: CompanyChangePreview[];
}

export async function findCompanies(nit: string): Promise<{
  matches: PublicConnection[];
  serverErrors: { serverLabel: string; error: string }[];
}> {
  const wanted = normalizeNit(nit);
  if (!wanted) return { matches: [], serverErrors: [] };
  const { connections, serverErrors } = await discoverConnections();
  return { matches: connections.filter((c) => normalizeNit(c.nit) === wanted), serverErrors };
}

export async function previewCompany(connection: PublicConnection): Promise<CompanyPreview> {
  const config = getConnectionById(connection.id);
  return withConnection(config, async (conn) => {
    const changes: CompanyChangePreview[] = [];
    for (const change of COMPANY_CHANGES) {
      const label = change.name;
      try {
        const { table, column } = await resolveChange(conn, connection.database, change);
        const [rows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT ${q(column)} AS v FROM ${q(connection.database)}.${q(table)} LIMIT 5`
        );
        const [count] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM ${q(connection.database)}.${q(table)}`
        );
        changes.push({
          column: change.column,
          label,
          current: rows.map((r) => (r.v == null ? null : String(r.v))),
          rows: Number(count[0].n),
        });
      } catch (err) {
        console.error(`[licencias] ${connection.id} ${change.column}:`, err);
        changes.push({ column: change.column, label, current: [], rows: 0, error: "No se pudo leer este dato" });
      }
    }
    return { connection, changes };
  });
}

// ---------- activar ----------

export interface ActivationStep {
  where: string;
  detail: string;
  ok: boolean;
}

export async function activateLicense(
  nit: string,
  nombre: string | null,
  hasta: string,
  connectionIds: string[]
) {
  if (!isValidDate(hasta)) throw new Error("Fecha no valida");

  // La tabla licencia no tiene llave unica y hay NITs repetidos (p. ej. 2147483647),
  // asi que la fila se ubica por NIT y nombre, y debe ser exactamente una.
  const licenseDb = getLicenseDbConfig();
  const matching = await withConnection(licenseDb, async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM licencia WHERE nit = ? AND nombre <=> ?",
      [nit, nombre]
    );
    return Number(rows[0].n);
  });
  if (matching !== 1) {
    throw new Error(
      matching === 0
        ? "No se encontro la licencia (puede haber cambiado). Recarga la lista."
        : `Hay ${matching} licencias con el mismo NIT y nombre; no se actualizo nada. Corrige los datos repetidos primero.`
    );
  }

  // Solo se permiten bases cuyo NIT coincide (no se confia en lo que manda el navegador)
  const { matches } = await findCompanies(nit);
  const allowed = new Map(matches.map((m) => [m.id, m]));
  const targets = connectionIds.map((id) => {
    const match = allowed.get(id);
    if (!match) throw new Error(`La base ${id} no corresponde al NIT ${nit}`);
    return match;
  });

  const steps: ActivationStep[] = [];

  // 1. dbcontrol.licencia: hasta y dias (dias que faltan desde hoy hasta la nueva fecha)
  await withConnection(licenseDb, async (conn) => {
    const [result] = await conn.query<mysql.ResultSetHeader>(
      "UPDATE licencia SET hasta = ?, dias = DATEDIFF(?, CURDATE()) WHERE nit = ? AND nombre <=> ? LIMIT 1",
      [hasta, hasta, nit, nombre]
    );
    const [check] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT dias FROM licencia WHERE nit = ? AND nombre <=> ? LIMIT 1",
      [nit, nombre]
    );
    const dias = check[0]?.dias;
    steps.push({
      where: "Licencia",
      detail: `vence el ${hasta}${dias != null ? ` (${dias} días)` : ""}`,
      ok: result.affectedRows > 0,
    });
  });

  // 2. Base de cada empresa
  for (const target of targets) {
    try {
      await withConnection(getConnectionById(target.id), async (conn) => {
        for (const change of COMPANY_CHANGES) {
          const value = change.value(hasta);
          try {
            const { table, column } = await resolveChange(conn, target.database, change);
            await conn.query(`UPDATE ${q(target.database)}.${q(table)} SET ${q(column)} = ?`, [value]);
            steps.push({ where: `${target.serverLabel} · ${change.name}`, detail: "actualizado", ok: true });
          } catch (err) {
            console.error(`[licencias] ${target.id} ${change.column}:`, err);
            steps.push({ where: `${target.serverLabel} · ${change.name}`, detail: "no se pudo actualizar", ok: false });
          }
        }
      });
    } catch (err) {
      console.error(`[licencias] ${target.id} conexion:`, err);
      steps.push({
        where: target.serverLabel,
        detail: "no se pudo conectar",
        ok: false,
      });
    }
  }

  return { steps };
}
