// @vitest-environment node
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { NextRequest } from "next/server";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

let auth: typeof import("@/lib/auth/session");
let store: typeof import("@/lib/auth/store");
let oauth: typeof import("@/lib/auth/oauth");
let routes: typeof import("@/app/api/auth/[...action]/route");

const baseDatabaseUrl = (
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/talkbridge"
).replace(/^postgresql\+psycopg:\/\//, "postgresql://");
const testSchema = `tb_auth_test_${randomUUID().replaceAll("-", "")}`;

beforeAll(async () => {
  const admin = new Pool({ connectionString: baseDatabaseUrl });
  await admin.query(`CREATE SCHEMA ${testSchema}`);
  await admin.end();
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("options", `-csearch_path=${testSchema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.AUTH_URL = "http://127.0.0.1:3000";
  process.env.AUTH_SECRET = "test-secret-with-at-least-32-characters";
  auth = await import("@/lib/auth/session");
  store = await import("@/lib/auth/store");
  oauth = await import("@/lib/auth/oauth");
  routes = await import("@/app/api/auth/[...action]/route");
  await store.db();
});

beforeEach(async () => {
  jar.clear();
  await store.query(
    "DELETE FROM sessions; DELETE FROM connections; DELETE FROM flows; DELETE FROM demo_attempts; DELETE FROM users;",
  );
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
});

afterAll(async () => {
  if (store) await store.closeDb();
  const admin = new Pool({ connectionString: baseDatabaseUrl });
  await admin.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
  await admin.end();
});

const params = (...action: string[]) => ({
  params: Promise.resolve({ action }),
});

describe("authentication boundaries", () => {
  it("rejects cross-origin sign-in requests before creating a session", async () => {
    const response = await routes.POST(
      new NextRequest("http://127.0.0.1:3000/api/auth/demo", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      params("demo"),
    );
    expect(response.status).toBe(403);
    expect(await auth.getUser()).toBeNull();
  });

  it("rejects incorrect credentials and disables test login in production", async () => {
    const form = new FormData();
    form.set("email", "demo@talkbridge.local");
    form.set("password", "wrong");
    const response = await routes.POST(
      new NextRequest("http://127.0.0.1:3000/api/auth/demo", {
        method: "POST",
        headers: { origin: auth.appUrl() },
        body: form,
      }),
      params("demo"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("Incorrect");
    expect(await auth.getUser()).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(auth.demoEnabled()).toBe(false);
    const disabled = await routes.POST(
      new NextRequest("http://127.0.0.1:3000/api/auth/demo", {
        method: "POST",
        headers: { origin: auth.appUrl() },
      }),
      params("demo"),
    );
    expect(disabled.status).toBe(404);
  });

  it("hashes session tokens and revokes them on logout", async () => {
    await auth.createSession({
      id: "test:user",
      name: "Test",
      email: "test@example.com",
      provider: "github",
    });
    const token = jar.get(auth.SESSION_COOKIE)!;
    expect((await auth.getUser())?.id).toBe("test:user");
    const row = (
      await store.query<{ token: string }>("SELECT token FROM sessions")
    ).rows[0];
    expect(row.token).not.toBe(token);
    expect(row.token).toBe(store.hash(token));
    await auth.logout();
    jar.set(auth.SESSION_COOKIE, token);
    expect(await auth.getUser()).toBeNull();
  });

  it("encrypts tokens with authenticated encryption", async () => {
    const encrypted = await store.encrypt("private-provider-token");
    expect(encrypted).not.toContain("private-provider-token");
    expect(await store.decrypt(encrypted)).toBe("private-provider-token");
    const altered = Buffer.from(encrypted, "base64url");
    altered[15] ^= 1;
    await expect(store.decrypt(altered.toString("base64url"))).rejects.toThrow();
  });

  it("binds OAuth state to the browser, expires it, and consumes it once", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-secret");
    const url = new URL(await oauth.startOAuth("github", "login"));
    const state = url.searchParams.get("state")!;
    const browser = jar.get("talkbridge_oauth")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).not.toContain("repo");
    jar.set("talkbridge_oauth", "wrong-browser");
    await expect(oauth.finishOAuth("github", state, "code")).rejects.toThrow(
      "expired",
    );
    jar.set("talkbridge_oauth", browser);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "provider-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 123, login: "developer" }),
      });
    vi.stubGlobal("fetch", fetch);
    await expect(oauth.finishOAuth("github", state, "code")).resolves.toBe(
      "/dashboard",
    );
    expect((await auth.getUser())?.id).toBe("github:123");
    jar.set("talkbridge_oauth", browser);
    await expect(oauth.finishOAuth("github", state, "code")).rejects.toThrow(
      "expired",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const expired = new URL(await oauth.startOAuth("github", "login"));
    await store.query("UPDATE flows SET expires=0");
    await expect(
      oauth.finishOAuth("github", expired.searchParams.get("state")!, "code"),
    ).rejects.toThrow("expired");
  });

  it("requires sign-in for connections and keeps repository tokens user-scoped", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-secret");
    await expect(oauth.startOAuth("github", "connect")).rejects.toThrow(
      "Sign in",
    );
    await auth.createSession({
      id: "owner",
      name: "Owner",
      email: "",
      provider: "github",
    });
    await store.query("INSERT INTO connections VALUES ($1,$2,$3,$4,$5)", [
      "owner",
      "github",
      "owner",
      await store.encrypt(JSON.stringify({ access_token: "secret" })),
      null,
    ]);
    await expect(oauth.repositories("other-user", "github")).rejects.toThrow(
      "Connect your account",
    );
    expect(JSON.stringify(await oauth.connections("owner"))).not.toContain(
      "secret",
    );
  });

  it("rejects Google identities without a verified email", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    const url = new URL(await oauth.startOAuth("google", "login"));
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "google-token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: "google-123",
            email: "person@example.com",
            email_verified: false,
          }),
        }),
    );
    await expect(
      oauth.finishOAuth("google", url.searchParams.get("state")!, "code"),
    ).rejects.toThrow("Verify your Google email");
    expect(await auth.getUser()).toBeNull();
  });

  it("rejects a connection callback if the signed-in account changed", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-secret");
    await auth.createSession({
      id: "first",
      name: "First",
      email: "",
      provider: "github",
    });
    const url = new URL(await oauth.startOAuth("github", "connect"));
    expect(url.searchParams.get("scope")).toContain("repo");
    await auth.createSession({
      id: "second",
      name: "Second",
      email: "",
      provider: "github",
    });
    await expect(
      oauth.finishOAuth("github", url.searchParams.get("state")!, "code"),
    ).rejects.toThrow("session changed");
    expect(await oauth.connections("first")).toEqual([]);
    expect(await oauth.connections("second")).toEqual([]);
  });

  it("restricts production sessions to explicit workspace members", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOWED_IDENTITIES", "github:allowed");
    await expect(
      auth.createSession({
        id: "github:outsider",
        name: "Outsider",
        email: "",
        provider: "github",
      }),
    ).rejects.toThrow("not authorized");
    await auth.createSession({
      id: "github:allowed",
      name: "Member",
      email: "",
      provider: "github",
    });
    expect((await auth.getUser())?.id).toBe("github:allowed");
    vi.stubEnv("AUTH_ALLOWED_IDENTITIES", "");
    expect(await auth.getUser()).toBeNull();
  });

  it("allows localhost and 127.0.0.1 origins in development when AUTH_URL is unset", async () => {
    const saved = process.env.AUTH_URL;
    delete process.env.AUTH_URL;
    try {
      const form = new FormData();
      form.set("email", "demo@talkbridge.local");
      form.set("password", "TalkBridgeDemo!2026");
      const response = await routes.POST(
        new NextRequest("http://localhost:3000/api/auth/demo", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          body: form,
        }),
        params("demo"),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/dashboard",
      );
    } finally {
      if (saved !== undefined) process.env.AUTH_URL = saved;
    }
  });

  it("deduplicates concurrent OAuth token refreshes per user and provider", async () => {
    vi.stubEnv("GITLAB_CLIENT_ID", "gl-id");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gl-secret");
    await auth.createSession({
      id: "gl-user",
      name: "GL",
      email: "",
      provider: "github",
    });
    await store.query("INSERT INTO connections VALUES ($1,$2,$3,$4,$5)", [
      "gl-user",
      "gitlab",
      "gl-user",
      await store.encrypt(
        JSON.stringify({
          access_token: "old-access",
          refresh_token: "old-refresh",
        }),
      ),
      Date.now() - 1000,
    ]);
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/oauth/token")) {
          tokenCalls++;
          await new Promise((r) => setTimeout(r, 10));
          return {
            ok: true,
            json: async () => ({
              access_token: "fresh-access",
              refresh_token: "fresh-refresh",
              expires_in: 7200,
            }),
          };
        }
        return { ok: true, json: async () => [] };
      }),
    );
    await Promise.all([
      oauth.repositories("gl-user", "gitlab"),
      oauth.repositories("gl-user", "gitlab"),
    ]);
    expect(tokenCalls).toBe(1);
  });
});
