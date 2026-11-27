import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file =
  process.env.AUTH_DATABASE_PATH || resolve(process.cwd(), "data/auth.db");
let database: DatabaseSync | undefined;
export function db() {
  if (database) return database;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(file);
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, provider TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, account TEXT NOT NULL, credentials TEXT NOT NULL, expires INTEGER, PRIMARY KEY(user_id,provider));
    CREATE TABLE IF NOT EXISTS flows (state TEXT PRIMARY KEY, browser TEXT NOT NULL, provider TEXT NOT NULL, intent TEXT NOT NULL, user_id TEXT, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function secret() {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32)
    return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  const current = db()
    .prepare("SELECT value FROM settings WHERE key='secret'")
    .get() as { value: string } | undefined;
  if (current) return current.value;
  const value = randomBytes(32).toString("base64url");
  db().prepare("INSERT OR IGNORE INTO settings VALUES ('secret',?)").run(value);
  return (
    db().prepare("SELECT value FROM settings WHERE key='secret'").get() as {
      value: string;
    }
  ).value;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret()).digest(),
    iv,
  );
  return Buffer.concat([
    iv,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret()).digest(),
    data.subarray(0, 12),
  );
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
