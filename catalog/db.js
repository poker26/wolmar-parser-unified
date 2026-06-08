// Пул к prod-БД (self-hosted Supabase). Читает .env приложения вручную (dotenv может отсутствовать).
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadEnv() {
  const env = {};
  const p = path.join(__dirname, "..", ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const pool = new Pool({
  host: env.DB_HOST,
  port: parseInt(env.DB_PORT, 10) || 5432,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: false,
});

module.exports = { pool };
