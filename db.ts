import mysql from "mysql2/promise";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type Connection = mysql.Connection;

export async function createConnection(config: DbConfig): Promise<Connection> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 20000,
  });
  return connection;
}

export async function closeConnection(connection: Connection): Promise<void> {
  await connection.end();
}
