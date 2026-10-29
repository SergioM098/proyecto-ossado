import { db1Config, db2Config } from "./config.js";
import { createConnection } from "./db.js";
for (const cfg of [db1Config, db2Config]) {
  const c = await createConnection(cfg);
  const [r] = await c.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='creditos' AND COLUMN_NAME='cliente'");
  console.log(cfg.database, r);
  await c.end();
}
