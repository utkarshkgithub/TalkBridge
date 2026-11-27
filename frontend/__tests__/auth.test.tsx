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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const directory = mkdtempSync(join(tmpdir(), "talkbridge-auth-"));
beforeAll(async () => {
  process.env.AUTH_DATABASE_PATH = join(directory, "auth.db");
  process.env.AUTH_URL = "http://127.0.0.1:3000";
  process.env.AUTH_SECRET = "test-secret-with-at-least-32-characters";
  auth = await import("@/lib/auth/session");
  store = await import("@/lib/auth/store");
  oauth = await import("@/lib/auth/oauth");
  routes = await import("@/app/api/auth/[...action]/route");
});
beforeEach(() => {
  jar.clear();
  store
    .db()
    .exec("DELETE FROM sessions; DELETE FROM connections; DELETE FROM flows;");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
});
afterAll(() => {
  store.db().close();
  rmSync(directory, { recursive: true, force: true });
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
    const row = store.db().prepare("SELECT token FROM sessions").get() as {
      token: string;
    };
    expect(row.token).not.toBe(token);
    expect(row.token).toBe(store.hash(token));
    await auth.logout();
    jar.set(auth.SESSION_COOKIE, token);
    expect(await auth.getUser()).toBeNull();
  });
  it("encrypts tokens with authenticated encryption", () => {
    const encrypted = store.encrypt("private-provider-token");
    expect(encrypted).not.toContain("private-provider-token");
    expect(store.decrypt(encrypted)).toBe("private-provider-token");
    const altered = Buffer.from(encrypted, "base64url");
    altered[15] ^= 1;
    expect(() => store.decrypt(altered.toString("base64url"))).toThrow();
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
    store.db().prepare("UPDATE flows SET expires=0").run();
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
    store
      .db()
      .prepare("INSERT INTO connections VALUES (?,?,?,?,?)")
      .run(
        "owner",
        "github",
        "owner",
        store.encrypt(JSON.stringify({ access_token: "secret" })),
        null,
      );
    await expect(oauth.repositories("other-user", "github")).rejects.toThrow(
      "Connect your account",
    );
    expect(JSON.stringify(oauth.connections("owner"))).not.toContain("secret");
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
    expect(oauth.connections("first")).toEqual([]);
    expect(oauth.connections("second")).toEqual([]);
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
});
