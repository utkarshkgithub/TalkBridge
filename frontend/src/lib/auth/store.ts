import { Pool, type QueryResultRow } from "pg";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

function connectionString() {
  const url =
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "postgresql://postgres:postgres@localhost:5432/talkbridge");
  if (!url) throw new Error("DATABASE_URL is required in production.");
  if (!url.startsWith("postgresql") && !url.startsWith("postgres://"))
    throw new Error("DATABASE_URL must use a postgresql scheme.");
  return url.replace(/^postgresql\+psycopg:\/\//, "postgresql://");
}

let poolPromise: Promise<Pool> | undefined;
let activePool: Pool | undefined;

export async function db() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const pool = new Pool({ connectionString: connectionString() });
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, provider TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS connections (user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, account TEXT NOT NULL, credentials TEXT NOT NULL, expires BIGINT, PRIMARY KEY(user_id,provider));
          CREATE TABLE IF NOT EXISTS flows (state TEXT PRIMARY KEY, browser TEXT NOT NULL, provider TEXT NOT NULL, intent TEXT NOT NULL, user_id TEXT, verifier TEXT NOT NULL, expires BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS demo_attempts (email TEXT PRIMARY KEY, count INTEGER NOT NULL, "reset" BIGINT NOT NULL);
        `);
        activePool = pool;
        return pool;
      } catch (error) {
        await pool.end().catch(() => {});
        throw error;
      }
    })().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  const pool = await db();
  return pool.query<T>(text, params);
}

export async function closeDb() {
  const pool = activePool;
  poolPromise = undefined;
  activePool = undefined;
  if (pool) await pool.end();
}

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function secret() {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32)
    return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  const current = (
    await query<{ value: string }>(
      "SELECT value FROM settings WHERE key='secret'",
    )
  ).rows[0];
  if (current) return current.value;
  const value = randomBytes(32).toString("base64url");
  await query(
    "INSERT INTO settings (key, value) VALUES ('secret', $1) ON CONFLICT (key) DO NOTHING",
    [value],
  );
  return (
    await query<{ value: string }>(
      "SELECT value FROM settings WHERE key='secret'",
    )
  ).rows[0].value;
}

export async function encrypt(value: string) {
  const key = createHash("sha256").update(await secret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}

export async function decrypt(value: string) {
  const key = createHash("sha256").update(await secret()).digest();
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    decipher.update(data.subarray(12, -16)),
    decipher.final(),
  ]).toString();
}

export type User = {
  id: string;
  name: string;
  email: string;
  provider: string;
};

export type Connection = {
  provider: string;
  account: string;
  expires: number | null;
};
