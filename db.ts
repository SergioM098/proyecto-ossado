import mysql from "mysql2/promise";
import type { DbConfig } from "./config.js";

export type Connection = mysql.Connection;

export async function createConnection(config: DbConfig): Promise<Connection> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
  });
  return connection;
}

export async function closeConnection(connection: Connection): Promise<void> {
  await connection.end();
}
