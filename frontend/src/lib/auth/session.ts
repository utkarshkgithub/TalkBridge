import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { db, hash, secret, type User } from "./store";

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
export function demoEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEMO_AUTH_ENABLED !== "false"
  );
}
function identityAllowed(id: string) {
  if (process.env.NODE_ENV !== "production") return true;
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
    (db()
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
      )
      .get(hash(token), Date.now()) as User | undefined) || null;
  return user && identityAllowed(user.id) ? user : null;
}
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
export async function createSession(user: User) {
  secret();
  if (!identityAllowed(user.id))
    throw new Error(
      "This account is not authorized for this workspace. Contact the administrator.",
    );
  db()
    .prepare(
      "INSERT INTO users VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
    )
    .run(user.id, user.name, user.email, user.provider);
  const jar = await cookies();
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old) db().prepare("DELETE FROM sessions WHERE token=?").run(hash(old));
  db().prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
  const token = randomBytes(32).toString("base64url");
  db()
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(hash(token), user.id, Date.now() + 7 * 86400_000);
  jar.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 7 * 86400 });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token)
    db().prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
