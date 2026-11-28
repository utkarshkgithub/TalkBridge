import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  allowedOrigin,
  appUrl,
  createSession,
  demoEnabled,
  getUser,
  logout,
  requestOrigin,
} from "@/lib/auth/session";
import {
  availableProviders,
  connections,
  finishOAuth,
  isProvider,
  repositories,
  startOAuth,
  syncGitHubInstallations,
  unlinkInstallation,
} from "@/lib/auth/oauth";
import { query } from "@/lib/auth/store";

function result(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function fail(message: string, destination = "/login", origin = appUrl()) {
  return NextResponse.redirect(
    new URL(`${destination}?error=${encodeURIComponent(message)}`, origin),
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
  if (action.length === 2 && action[0] === "github" && action[1] === "setup") {
    if (!user)
      return NextResponse.redirect(new URL("/login", appUrl()), 303);
    const rawId = request.nextUrl.searchParams.get("installation_id");
    const parsedId = rawId ? Number(rawId) : undefined;
    const expectedId =
      parsedId && Number.isInteger(parsedId) && parsedId > 0
        ? parsedId
        : undefined;
    try {
      await syncGitHubInstallations(user.id, expectedId);
      return NextResponse.redirect(
        new URL("/connections?installed=1", appUrl()),
        303,
      );
    } catch (error) {
      return fail(
        error instanceof Error
          ? error.message
          : "Could not verify GitHub App installation.",
        "/connections",
      );
    }
  }
  const provider = action[1];
  if (!provider || !isProvider(provider))
    return result({ error: "Not found" }, 404);
  try {
    if (action.length === 2 && action[0] === "callback") {
      const state = request.nextUrl.searchParams.get("state") || "";
      const code = request.nextUrl.searchParams.get("code") || "";
      const installationId = request.nextUrl.searchParams.get("installation_id");
      const setupAction = request.nextUrl.searchParams.get("setup_action");
      if (
        provider === "github" &&
        !state &&
        user &&
        installationId &&
        (setupAction === "install" || setupAction === "update")
      ) {
        const parsed = Number(installationId);
        const setupTarget = new URL("/api/auth/github/setup", appUrl());
        if (Number.isInteger(parsed) && parsed > 0)
          setupTarget.searchParams.set("installation_id", String(parsed));
        return NextResponse.redirect(setupTarget, 303);
      }
      const path = await finishOAuth(provider, state, code);
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
  if (!allowedOrigin(request))
    return result({ error: "Invalid request origin" }, 403);
  const origin = requestOrigin(request);
  const { action } = await params;
  if (action.length === 1 && action[0] === "logout") {
    await logout();
    return NextResponse.redirect(new URL("/login", origin), 303);
  }
  if (action.length === 1 && action[0] === "demo") {
    if (!demoEnabled())
      return result({ error: "Test sign-in is disabled" }, 404);
    const form = await request.formData();
    const email = String(form.get("email") || "").slice(0, 254);
    const password = String(form.get("password") || "").slice(0, 256);
    const attemptKey = email.trim().toLowerCase() || "__empty__";
    const now = Date.now();
    await query(
      `INSERT INTO demo_attempts (email, count, "reset")
       VALUES ($1, 0, $2)
       ON CONFLICT(email) DO UPDATE
       SET count = CASE WHEN demo_attempts."reset" < $3 THEN 0 ELSE demo_attempts.count END,
           "reset" = CASE WHEN demo_attempts."reset" < $3 THEN excluded."reset" ELSE demo_attempts."reset" END`,
      [attemptKey, now + 900000, now],
    );
    const attempts = (
      await query<{ count: number }>(
        "SELECT count FROM demo_attempts WHERE email=$1",
        [attemptKey],
      )
    ).rows[0];
    if (attempts.count >= 8)
      return fail(
        "Too many attempts. Try again in 15 minutes.",
        "/login",
        origin,
      );
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
      await query("UPDATE demo_attempts SET count=count+1 WHERE email=$1", [
        attemptKey,
      ]);
      return fail("Incorrect test email or password.", "/login", origin);
    }
    await query("UPDATE demo_attempts SET count=0 WHERE email=$1", [
      attemptKey,
    ]);
    await createSession({
      id: "demo:local",
      name: "Demo developer",
      email,
      provider: "demo",
    });
    return NextResponse.redirect(new URL("/dashboard", origin), 303);
  }
  if (action.length === 2 && action[0] === "installations") {
    const user = await getUser();
    if (!user) return result({ error: "Sign in required" }, 401);
    if (action[1] === "sync") {
      try {
        return result({ items: await syncGitHubInstallations(user.id) });
      } catch (error) {
        return result(
          {
            error:
              error instanceof Error
                ? error.message
                : "Could not sync installations.",
          },
          400,
        );
      }
    }
    if (action[1] === "unlink") {
      const body = (await request.json().catch(() => ({}))) as {
        installation_id?: unknown;
      };
      const id = Number(body.installation_id);
      if (!Number.isInteger(id) || id < 1)
        return result({ error: "Invalid installation_id" }, 400);
      return result({ items: await unlinkInstallation(user.id, id) });
    }
    return result({ error: "Not found" }, 404);
  }
  const provider = action[1];
  if (!provider || !isProvider(provider) || action.length !== 2)
    return result({ error: "Not found" }, 404);
  const user = await getUser();
  if (action[0] === "disconnect") {
    if (!user) return result({ error: "Sign in required" }, 401);
    await query("DELETE FROM connections WHERE user_id=$1 AND provider=$2", [
      user.id,
      provider,
    ]);
    if (provider === "github") {
      await query("DELETE FROM user_installations WHERE user_id=$1", [user.id]);
      await query(
        `UPDATE github_installations
         SET status = 'pending', updated_at = now()
         WHERE status = 'active'
           AND NOT EXISTS (SELECT 1 FROM user_installations WHERE installation_id = github_installations.installation_id)`,
      );
    }
    return result({ connections: await connections(user.id) });
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
      origin,
    );
  }
}
