export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// Base de datos 1 (TARGET - donde se copiarán tablas/columnas faltantes)
export const db1Config: DbConfig = {
  host: "66.94.100.31",
  port: 3306,
  user: "ossadosystem",
  password: "ossadoprogram",
  database: "sosol",
};

// Base de datos 2 (SOURCE - de donde se leen las tablas/columnas)
export const db2Config: DbConfig = {
  host: "209.126.87.129",
  port: 3306,
  user: "ossadosystem",
  password: "ossadoprogram",
  database: "ewo",
};
