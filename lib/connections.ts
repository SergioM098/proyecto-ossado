import mysql from "mysql2/promise";
import type { DbConfig } from "../db";

interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

// Info segura para mandar al navegador (sin usuario ni contraseña)
export interface PublicConnection {
  id: string; // "<serverId>/<database>"
  serverId: string;
  serverLabel: string;
  database: string;
  nit: string | null;
  nombre: string | null;
}

export interface ServerError {
  serverLabel: string;
  error: string;
}

const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

// DB_SERVERS es un JSON con un arreglo de servidores MySQL:
// [{"id":"s66","label":"Servidor 66","host":"66.94.100.31","port":3306,"user":"u","password":"p"}]
// Las bases de cada servidor se descubren solas.
export function getServers(): ServerEntry[] {
  const raw = process.env.DB_SERVERS;
  if (!raw) throw new Error("Falta la variable de entorno DB_SERVERS");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DB_SERVERS no es un JSON valido");
  }
  if (!Array.isArray(parsed)) throw new Error("DB_SERVERS debe ser un arreglo");

  return parsed.map((s, i) => {
    for (const key of ["id", "host", "user", "password"]) {
      if (typeof s?.[key] !== "string" || !s[key]) {
        throw new Error(`DB_SERVERS[${i}] no tiene '${key}'`);
      }
    }
    if (s.id.includes("/")) throw new Error(`DB_SERVERS[${i}].id no puede tener '/'`);
    return {
      id: s.id,
      label: s.label || s.host,
      host: s.host,
      port: Number(s.port) || 3306,
      user: s.user,
      password: s.password,
    };
  });
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function cleanValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

// Lee NIT y nombre de la tabla empresas de una base. Busca la tabla y las columnas
// sin importar mayusculas (en servidores Linux los nombres de tabla las distinguen).
async function readEmpresa(
  pool: mysql.Pool,
  database: string
): Promise<{ nit: string | null; nombre: string | null }> {
  const db = quoteIdentifier(database);

  const [tables] = await pool.query<mysql.RowDataPacket[]>(`SHOW TABLES FROM ${db}`);
  const table = tables
    .map((r) => String(Object.values(r)[0]))
    .find((name) => name.toLowerCase() === "empresas");
  if (!table) throw new Error("no tiene tabla empresas");

  const [columns] = await pool.query<mysql.RowDataPacket[]>(
    `SHOW COLUMNS FROM ${db}.${quoteIdentifier(table)}`
  );
  const findColumn = (wanted: string) =>
    columns.map((c) => String(c.Field)).find((name) => name.toLowerCase() === wanted);
  const nitColumn = findColumn("nit");
  const nombreColumn = findColumn("nombre");
  if (!nitColumn && !nombreColumn) throw new Error(`la tabla ${table} no tiene columnas nit ni nombre`);

  const fields = [
    nitColumn ? `${quoteIdentifier(nitColumn)} AS nit` : "NULL AS nit",
    nombreColumn ? `${quoteIdentifier(nombreColumn)} AS nombre` : "NULL AS nombre",
  ].join(", ");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ${fields} FROM ${db}.${quoteIdentifier(table)} LIMIT 1`
  );
  if (!rows[0]) throw new Error(`la tabla ${table} esta vacia`);

  return { nit: cleanValue(rows[0].nit), nombre: cleanValue(rows[0].nombre) };
}

async function discoverServer(server: ServerEntry): Promise<PublicConnection[]> {
  const pool = mysql.createPool({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    connectionLimit: 5,
    connectTimeout: 10000,
  });

  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SHOW DATABASES");
    const databases = rows
      .map((r) => String(Object.values(r)[0]))
      .filter((db) => !SYSTEM_DATABASES.has(db.toLowerCase()));

    return await Promise.all(
      databases.map(async (database) => {
        const { nit, nombre } = await readEmpresa(pool, database).catch((err) => {
          console.warn(
            `[empresas] ${server.label}/${database}:`,
            err instanceof Error ? err.message : err
          );
          return { nit: null, nombre: null };
        });
        return {
          id: `${server.id}/${database}`,
          serverId: server.id,
          serverLabel: server.label,
          database,
          nit,
          nombre,
        };
      })
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function discoverConnections(): Promise<{
  connections: PublicConnection[];
  serverErrors: ServerError[];
}> {
  const servers = getServers();
  const results = await Promise.allSettled(servers.map(discoverServer));

  const connections: PublicConnection[] = [];
  const serverErrors: ServerError[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") connections.push(...r.value);
    else
      serverErrors.push({
        serverLabel: servers[i].label,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
  });

  connections.sort((a, b) =>
    (a.nombre ?? a.database).localeCompare(b.nombre ?? b.database, "es")
  );
  return { connections, serverErrors };
}

// Convierte "<serverId>/<database>" en la configuracion para conectarse
export function getConnectionById(id: string): DbConfig {
  const slash = id.indexOf("/");
  const serverId = slash > 0 ? id.slice(0, slash) : "";
  const database = slash > 0 ? id.slice(slash + 1) : "";

  const server = getServers().find((s) => s.id === serverId);
  if (
    !server ||
    !/^[A-Za-z0-9_$-]{1,64}$/.test(database) ||
    SYSTEM_DATABASES.has(database.toLowerCase())
  ) {
    throw new Error(`Conexion '${id}' no valida`);
  }

  return {
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database,
  };
}
