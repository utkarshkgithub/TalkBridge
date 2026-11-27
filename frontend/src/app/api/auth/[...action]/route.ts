import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  appUrl,
  createSession,
  demoEnabled,
  getUser,
  logout,
} from "@/lib/auth/session";
import {
  availableProviders,
  connections,
  finishOAuth,
  isProvider,
  repositories,
  startOAuth,
} from "@/lib/auth/oauth";
import { db } from "@/lib/auth/store";

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === appUrl();
}
function result(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function fail(message: string, destination = "/login") {
  return NextResponse.redirect(
    new URL(`${destination}?error=${encodeURIComponent(message)}`, appUrl()),
    303,
  );
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string[] }> },
) {
  const { action } = await params;
  const user = await getUser();
  if (action.length === 1 && action[0] === "session")
    return result({
      user,
      providers: availableProviders(),
      demoEnabled: demoEnabled(),
    });
  const provider = action[1];
  if (!provider || !isProvider(provider))
    return result({ error: "Not found" }, 404);
  try {
    if (action.length === 2 && action[0] === "callback") {
      const path = await finishOAuth(
        provider,
        request.nextUrl.searchParams.get("state") || "",
        request.nextUrl.searchParams.get("code") || "",
      );
      return NextResponse.redirect(new URL(path, appUrl()), 303);
    }
    if (!user) return result({ error: "Sign in required" }, 401);
    if (action.length === 2 && action[0] === "repositories")
      return result({ items: await repositories(user.id, provider) });
    return result({ error: "Not found" }, 404);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Authorization failed. Try again.";
    if (action[0] === "callback")
      return fail(message, user ? "/connections" : "/login");
    return result({ error: message }, 400);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string[] }> },
) {
  if (!sameOrigin(request))
    return result({ error: "Invalid request origin" }, 403);
  const { action } = await params;
  if (action.length === 1 && action[0] === "logout") {
    await logout();
    return NextResponse.redirect(new URL("/login", appUrl()), 303);
  }
  if (action.length === 1 && action[0] === "demo") {
    if (!demoEnabled())
      return result({ error: "Test sign-in is disabled" }, 404);
    const form = await request.formData();
    const email = String(form.get("email") || "").slice(0, 254);
    const password = String(form.get("password") || "").slice(0, 256);
    db().exec(
      "CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)",
    );
    db()
      .prepare(
        "INSERT INTO attempts VALUES (1,0,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN reset<? THEN 0 ELSE count END,reset=CASE WHEN reset<? THEN excluded.reset ELSE reset END",
      )
      .run(Date.now() + 900000, Date.now(), Date.now());
    const attempts = db()
      .prepare("SELECT count FROM attempts WHERE id=1")
      .get() as { count: number };
    if (attempts.count >= 8)
      return fail("Too many attempts. Try again in 15 minutes.");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    const correctEmail = timingSafeEqual(
      digest(email),
      digest(process.env.DEMO_AUTH_EMAIL || "demo@talkbridge.local"),
    );
    const correctPassword = timingSafeEqual(
      digest(password),
      digest(process.env.DEMO_AUTH_PASSWORD || "TalkBridgeDemo!2026"),
    );
    if (!correctEmail || !correctPassword) {
      db().prepare("UPDATE attempts SET count=count+1 WHERE id=1").run();
      return fail("Incorrect test email or password.");
    }
    db().prepare("UPDATE attempts SET count=0 WHERE id=1").run();
    await createSession({
      id: "demo:local",
      name: "Demo developer",
      email,
      provider: "demo",
    });
    return NextResponse.redirect(new URL("/dashboard", appUrl()), 303);
  }
  const provider = action[1];
  if (!provider || !isProvider(provider) || action.length !== 2)
    return result({ error: "Not found" }, 404);
  const user = await getUser();
  if (action[0] === "disconnect") {
    if (!user) return result({ error: "Sign in required" }, 401);
    db()
      .prepare("DELETE FROM connections WHERE user_id=? AND provider=?")
      .run(user.id, provider);
    return result({ connections: connections(user.id) });
  }
  if (action[0] !== "login" && action[0] !== "connect")
    return result({ error: "Not found" }, 404);
  if (action[0] === "connect" && !user)
    return result({ error: "Sign in required" }, 401);
  try {
    return NextResponse.redirect(await startOAuth(provider, action[0]), 303);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Could not start authorization.",
      user ? "/connections" : "/login",
    );
  }
}
