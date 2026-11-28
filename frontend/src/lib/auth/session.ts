import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { hash, query, secret, type User } from "./store";

const DEV_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

export const SESSION_COOKIE = "talkbridge_session";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
export function appUrl() {
  const configured = process.env.AUTH_URL;
  if (!configured && process.env.NODE_ENV === "production")
    throw new Error("AUTH_URL is required in production.");
  return new URL(configured || "http://127.0.0.1:3000").origin;
}
export function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (process.env.AUTH_URL || process.env.NODE_ENV === "production")
    return origin === appUrl();
  return DEV_ORIGINS.has(origin);
}
export function requestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    !process.env.AUTH_URL &&
    process.env.NODE_ENV !== "production" &&
    DEV_ORIGINS.has(origin)
  )
    return origin;
  return appUrl();
}
export function demoEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEMO_AUTH_ENABLED !== "false"
  );
}
function identityAllowed(id: string) {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.AUTH_OPEN_SIGNUP === "true") return true;
  return (process.env.AUTH_ALLOWED_IDENTITIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(id);
}
export async function getUser(): Promise<User | null> {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user =
    (
      await query<User>(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires>$2",
        [hash(token), Date.now()],
      )
    ).rows[0] || null;
  return user && identityAllowed(user.id) ? user : null;
}
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
export async function createSession(user: User) {
  await secret();
  if (!identityAllowed(user.id))
    throw new Error(
      "This account is not authorized for this workspace. Contact the administrator.",
    );
  await query(
    "INSERT INTO users (id, name, email, provider) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
    [user.id, user.name, user.email, user.provider],
  );
  const jar = await cookies();
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old) await query("DELETE FROM sessions WHERE token=$1", [hash(old)]);
  await query("DELETE FROM sessions WHERE expires<=$1", [Date.now()]);
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token, user_id, expires) VALUES ($1,$2,$3)", [
    hash(token),
    user.id,
    Date.now() + 7 * 86400_000,
  ]);
  jar.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 7 * 86400 });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token=$1", [hash(token)]);
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
