import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import {
  decrypt,
  encrypt,
  hash,
  query,
  type Connection,
  type GitHubInstallation,
} from "./store";
import { appUrl, cookieOptions, createSession, getUser } from "./session";

export const providers = ["github", "google", "gitlab", "bitbucket"] as const;
export type Provider = (typeof providers)[number];
export function isProvider(value: string): value is Provider {
  return providers.includes(value as Provider);
}
const endpoints = {
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    user: "https://api.github.com/user",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    user: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  gitlab: {
    authorize: "https://gitlab.com/oauth/authorize",
    token: "https://gitlab.com/oauth/token",
    user: "https://gitlab.com/api/v4/user",
  },
  bitbucket: {
    authorize: "https://bitbucket.org/site/oauth2/authorize",
    token: "https://bitbucket.org/site/oauth2/access_token",
    user: "https://api.bitbucket.org/2.0/user",
  },
};
function credentials(provider: Provider) {
  const id = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
  const secret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
}
export function availableProviders() {
  return Object.fromEntries(providers.map((p) => [p, !!credentials(p)]));
}
const callback = (provider: Provider) =>
  `${appUrl()}/api/auth/callback/${provider}`;
async function jsonRequest(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "The provider could not complete this request. Please reconnect and try again.",
    );
  return response.json();
}
async function exchange(provider: Provider, body: URLSearchParams) {
  const config = credentials(provider);
  if (!config) throw new Error("This provider has not been configured yet.");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "bitbucket")
    headers.Authorization = `Basic ${Buffer.from(`${config.id}:${config.secret}`).toString("base64")}`;
  else {
    body.set("client_id", config.id);
    body.set("client_secret", config.secret);
  }
  const result = await jsonRequest(endpoints[provider].token, {
    method: "POST",
    headers,
    body,
  });
  if (typeof result.access_token !== "string")
    throw new Error("Authorization was not completed. Please try again.");
  return result as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}
export async function startOAuth(
  provider: Provider,
  intent: "login" | "connect",
) {
  const config = credentials(provider);
  if (!config) throw new Error("This provider has not been configured yet.");
  if (intent === "login" && provider !== "github" && provider !== "google")
    throw new Error("Use GitHub or Google to sign in.");
  if (intent === "connect" && provider === "google")
    throw new Error(
      "Google is a sign-in provider, not a repository connection.",
    );
  const user = await getUser();
  if (intent === "connect" && !user)
    throw new Error("Sign in before connecting an account.");
  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  await query("DELETE FROM flows WHERE expires<=$1", [Date.now()]);
  await query(
    "INSERT INTO flows (state, browser, provider, intent, user_id, verifier, expires) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      hash(state),
      hash(browser),
      provider,
      intent,
      intent === "connect" ? user!.id : null,
      verifier,
      Date.now() + 600_000,
    ],
  );
  (await cookies()).set("talkbridge_oauth", browser, {
    ...cookieOptions,
    maxAge: 600,
  });
  const url = new URL(endpoints[provider].authorize);
  url.search = new URLSearchParams({
    client_id: config.id,
    redirect_uri: callback(provider),
    response_type: "code",
    state,
  }).toString();
  if (provider !== "bitbucket") {
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
  }
  const scope =
    provider === "github"
      ? `read:user user:email${intent === "connect" ? " repo" : ""}`
      : provider === "google"
        ? "openid email profile"
        : "read_user read_api read_repository";
  if (provider !== "bitbucket") url.searchParams.set("scope", scope);
  return url.toString();
}
export async function finishOAuth(
  provider: Provider,
  state: string,
  code: string,
) {
  const jar = await cookies();
  const browser = jar.get("talkbridge_oauth")?.value;
  if (!browser || !state || !code)
    throw new Error("Authorization expired. Start again.");
  const flow = (
    await query<{ intent: string; user_id: string | null; verifier: string }>(
      "DELETE FROM flows WHERE state=$1 AND browser=$2 AND provider=$3 AND expires>$4 RETURNING *",
      [hash(state), hash(browser), provider, Date.now()],
    )
  ).rows[0];
  jar.set("talkbridge_oauth", "", { ...cookieOptions, maxAge: 0 });
  if (!flow) throw new Error("Authorization expired. Start again.");
  const current = await getUser();
  if (flow.intent === "connect" && current?.id !== flow.user_id)
    throw new Error("Your session changed. Sign in and reconnect.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callback(provider),
  });
  if (provider !== "bitbucket") body.set("code_verifier", flow.verifier);
  const token = await exchange(provider, body);
  const profile = await jsonRequest(endpoints[provider].user, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  const identity =
    provider === "google"
      ? profile.sub
      : provider === "bitbucket"
        ? profile.uuid
        : profile.id;
  if (typeof identity !== "string" && typeof identity !== "number")
    throw new Error("The provider did not return a valid account.");
  if (provider === "google" && profile.email_verified !== true)
    throw new Error("Verify your Google email before signing in.");
  const name = String(
    profile.name ||
      profile.display_name ||
      profile.login ||
      profile.username ||
      "Contributor",
  ).slice(0, 200);
  const account = String(
    profile.login || profile.username || profile.display_name || name,
  ).slice(0, 200);
  const expires = token.expires_in
    ? Date.now() + token.expires_in * 1000
    : null;
  if (flow.intent === "login") {
    const userId = `${provider}:${identity}`;
    await createSession({
      id: userId,
      name,
      email: typeof profile.email === "string" ? profile.email : "",
      provider,
    });
    if (provider === "github") {
      await query(
        "INSERT INTO connections (user_id, provider, account, credentials, expires) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id,provider) DO UPDATE SET account=excluded.account,credentials=excluded.credentials,expires=excluded.expires",
        [
          userId,
          provider,
          account,
          await encrypt(JSON.stringify(token)),
          expires,
        ],
      );
      await syncGitHubInstallations(userId).catch(() => []);
    }
    return "/dashboard";
  }
  await query(
    "INSERT INTO connections (user_id, provider, account, credentials, expires) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id,provider) DO UPDATE SET account=excluded.account,credentials=excluded.credentials,expires=excluded.expires",
    [
      current!.id,
      provider,
      account,
      await encrypt(JSON.stringify(token)),
      expires,
    ],
  );
  if (provider === "github")
    await syncGitHubInstallations(current!.id).catch(() => []);
  return "/connections?connected=" + provider;
}
export async function connections(userId: string): Promise<Connection[]> {
  const { rows } = await query<{
    provider: string;
    account: string;
    expires: string | number | null;
  }>("SELECT provider,account,expires FROM connections WHERE user_id=$1", [
    userId,
  ]);
  return rows.map((row) => ({
    provider: row.provider,
    account: row.account,
    expires: row.expires == null ? null : Number(row.expires),
  }));
}
type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};
const pendingRefreshes = new Map<string, Promise<TokenSet>>();

async function refreshConnectionToken(
  userId: string,
  provider: Provider,
  token: TokenSet,
) {
  const key = `${userId}:${provider}`;
  const existing = pendingRefreshes.get(key);
  if (existing) return existing;
  const task = (async () => {
    try {
      const fresh = await exchange(
        provider,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token!,
        }),
      );
      const updated: TokenSet = {
        ...fresh,
        refresh_token: fresh.refresh_token || token.refresh_token,
      };
      await query(
        "UPDATE connections SET credentials=$1,expires=$2 WHERE user_id=$3 AND provider=$4",
        [
          await encrypt(JSON.stringify(updated)),
          updated.expires_in ? Date.now() + updated.expires_in * 1000 : null,
          userId,
          provider,
        ],
      );
      return updated;
    } finally {
      pendingRefreshes.delete(key);
    }
  })();
  pendingRefreshes.set(key, task);
  return task;
}

async function validConnectionToken(userId: string, provider: Provider) {
  const connection = (
    await query<{ credentials: string; expires: string | number | null }>(
      "SELECT credentials,expires FROM connections WHERE user_id=$1 AND provider=$2",
      [userId, provider],
    )
  ).rows[0];
  if (!connection) throw new Error("Connect your account first.");
  let token = JSON.parse(await decrypt(connection.credentials)) as TokenSet;
  const expiresAt =
    connection.expires == null ? null : Number(connection.expires);
  if (expiresAt && expiresAt < Date.now() + 60000) {
    if (!token.refresh_token)
      throw new Error(
        "This connection expired. Disconnect and reconnect your account.",
      );
    token = await refreshConnectionToken(userId, provider, token);
  }
  return token;
}

export async function listInstallations(
  userId: string,
): Promise<GitHubInstallation[]> {
  const { rows } = await query<{
    installation_id: string | number;
    account_login: string;
    account_type: string;
    status: string;
    daily_limit: number;
    daily_count: number;
  }>(
    `SELECT g.installation_id, g.account_login, g.account_type, g.status,
            g.daily_limit,
            CASE WHEN g.usage_date = CURRENT_DATE THEN g.daily_count ELSE 0 END AS daily_count
     FROM github_installations g
     JOIN user_installations u ON u.installation_id = g.installation_id
     WHERE u.user_id = $1 AND g.status <> 'deleted'
     ORDER BY g.account_login, g.installation_id`,
    [userId],
  );
  return rows.map((row) => ({
    installation_id: Number(row.installation_id),
    account_login: row.account_login,
    account_type: row.account_type,
    status: row.status,
    daily_limit: row.daily_limit,
    daily_count: row.daily_count,
  }));
}

export async function syncGitHubInstallations(
  userId: string,
  expectedInstallationId?: number,
): Promise<GitHubInstallation[]> {
  const token = await validConnectionToken(userId, "github");
  const response = await fetch(
    "https://api.github.com/user/installations?per_page=100",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      "Could not verify GitHub App installations. Connect GitHub using your GitHub App credentials.",
    );
  const data = (await response.json()) as {
    installations?: Array<{
      id: number;
      account?: { login?: string; type?: string };
      suspended_at?: string | null;
    }>;
  };
  const items = Array.isArray(data.installations) ? data.installations : [];
  const dailyLimit = Math.max(
    1,
    Number(process.env.INSTALL_DAILY_LIMIT || 20) || 20,
  );
  const syncedIds: number[] = [];
  for (const item of items) {
    if (typeof item.id !== "number" || item.id < 1) continue;
    const status = item.suspended_at ? "suspended" : "active";
    const login = String(item.account?.login || "");
    const accountType = String(item.account?.type || "User");
    await query(
      `INSERT INTO github_installations (installation_id, account_login, account_type, status, daily_limit)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (installation_id) DO UPDATE
       SET account_login = EXCLUDED.account_login,
           account_type = EXCLUDED.account_type,
           status = CASE
             WHEN github_installations.status = 'deleted' THEN EXCLUDED.status
             WHEN EXCLUDED.status = 'suspended' THEN 'suspended'
             ELSE 'active'
           END,
           updated_at = now()`,
      [item.id, login, accountType, status, dailyLimit],
    );
    syncedIds.push(item.id);
  }
  await query("DELETE FROM user_installations WHERE user_id=$1", [userId]);
  for (const id of syncedIds) {
    await query(
      "INSERT INTO user_installations (user_id, installation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, id],
    );
  }
  if (
    expectedInstallationId !== undefined &&
    !syncedIds.includes(expectedInstallationId)
  )
    throw new Error(
      "This GitHub installation does not belong to your connected GitHub account.",
    );
  return listInstallations(userId);
}

export async function unlinkInstallation(
  userId: string,
  installationId: number,
) {
  await query(
    "DELETE FROM user_installations WHERE user_id=$1 AND installation_id=$2",
    [userId, installationId],
  );
  await query(
    `UPDATE github_installations
     SET status = 'pending', updated_at = now()
     WHERE installation_id = $1
       AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM user_installations WHERE installation_id = $1)`,
    [installationId],
  );
  return listInstallations(userId);
}

export async function repositories(userId: string, provider: Provider) {
  if (provider === "google") throw new Error("Choose a repository provider.");
  const token = await validConnectionToken(userId, provider);
  const url =
    provider === "github"
      ? "https://api.github.com/user/repos?per_page=30&sort=updated"
      : provider === "gitlab"
        ? "https://gitlab.com/api/v4/projects?membership=true&per_page=30&order_by=last_activity_at"
        : "https://api.bitbucket.org/2.0/repositories?role=member&pagelen=30&sort=-updated_on";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Could not load repositories. Check provider permissions or reconnect your account.",
    );
  const data = await response.json();
  const list = provider === "bitbucket" ? data.values : data;
  if (!Array.isArray(list))
    throw new Error("The provider returned an invalid repository list.");
  return list.map((repo: Record<string, unknown>) => ({
    id: String(repo.id || repo.uuid),
    name: String(repo.full_name || repo.path_with_namespace || repo.name),
    private:
      provider === "gitlab"
        ? repo.visibility !== "public"
        : !!(repo.private || repo.is_private),
  }));
}
