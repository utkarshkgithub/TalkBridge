# TalkBridge frontend

The public landing page is `/`. Sign in at `/login` to open `/dashboard`, `/reviews`, `/insights`, `/workflow`, and `/connections`.

## Local setup

Use Node.js 22.13 or newer. The authentication store uses Node's built-in SQLite module. Review artifacts remain in the backend PostgreSQL database.

```bash
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open http://127.0.0.1:3000. Use this same origin in `AUTH_URL`; changing between `localhost` and `127.0.0.1` changes the cookie origin and OAuth callback.

Start the backend with PostgreSQL storage and `DEMO_REPLAY_MODE=true` as described in the root README. The frontend's test sign-in uses:

- Email: `demo@talkbridge.local`
- Password: `TalkBridgeDemo!2026`

The login form can fill these credentials. This is an explicit local test account, not an email registration system. It is unavailable when `NODE_ENV=production`, even if `DEMO_AUTH_ENABLED=true`. Override the email/password with the variables in `.env.example` or set `DEMO_AUTH_ENABLED=false` to disable it locally.

## OAuth applications

Configure provider client IDs and secrets in `.env.local`, never `NEXT_PUBLIC_*` variables. Restart Next.js after configuration changes. Unconfigured providers are disabled and labeled in the interface.

| Provider | Purpose | Callback path | Permissions |
| --- | --- | --- | --- |
| GitHub | Sign in and connect repositories | `/api/auth/callback/github` | Login: `read:user user:email`. Connection: additionally `repo`, which includes private repository access. |
| Google | Sign in | `/api/auth/callback/google` | `openid email profile`; verified email required. |
| GitLab.com | Connect projects | `/api/auth/callback/gitlab` | `read_user read_api read_repository` |
| Bitbucket Cloud | Connect repositories | `/api/auth/callback/bitbucket` | Configure account read and repository read on the OAuth consumer. |

Register each full callback URL using the `AUTH_URL` origin. Users complete provider consent themselves. GitHub and Google login identities are separate accounts; email addresses are not automatically merged. Connecting a repository provider requires an existing session and is distinct from logging in.

Connections list up to 30 recently updated repositories from the provider. GitLab and Bitbucket currently support authorization and repository browsing, not automated review ingestion or publication. Automated GitHub reviews still use the backend's GitHub App and signed webhook configuration. Connecting an OAuth account does not install that App or create webhooks. Disconnecting removes stored credentials locally; revoke the authorization in provider settings to remove it there as well.

## Sessions and deployment

This is a **single shared development workspace**. All signed-in members can inspect the same backend reviews. Production requires an explicit `AUTH_ALLOWED_IDENTITIES` membership list; unlisted provider identities cannot sign in or use an existing session. Development allows provider accounts for local OAuth testing. Provider connections are private to each account. This is not a multi-tenant SaaS deployment.

Sessions use random opaque tokens in HttpOnly, SameSite=Lax cookies and expire after seven days. Only token hashes are stored. POST routes validate the request origin. OAuth uses single-use, expiring browser-bound state and PKCE where supported. Provider access/refresh tokens are encrypted at rest with AES-256-GCM; access tokens are not sent to the browser. Expiring provider connections refresh their token when available.

For deployment:

1. Set an HTTPS `AUTH_URL` and register matching OAuth callbacks.
2. Set `AUTH_SECRET` to at least 32 random characters, for example `openssl rand -hex 32`.
3. Set `AUTH_ALLOWED_IDENTITIES` to the allowed immutable provider identities (for example `github:123456` or `google:123456789012345678901`). GitHub uses the numeric user `id`; Google uses the OpenID `sub`. Empty membership denies all production sign-ins.
4. Persist `AUTH_DATABASE_PATH` and keep the same `AUTH_SECRET` across restarts. A single Node server instance with persistent disk is required by the current SQLite store. Ephemeral/serverless storage and multiple replicas need a shared database implementation first.
5. Set the same random `DASHBOARD_API_KEY` (at least 32 characters) in the frontend and backend environments. Set backend `APP_ENV=prod` to enforce this requirement. Dashboard APIs then accept only the server gateway key. Keep the backend on a private network. Webhooks keep their independent HMAC authentication.
6. Keep review data in PostgreSQL. Back up both databases and protect their filesystem permissions.

Without an explicit `AUTH_SECRET`, development persists a generated local encryption key in `data/auth.db`. Do not commit this database. Production cookies use `Secure`, and test credentials are disabled.

The pipeline screen displays the architecture and recorded stage timings. It does not claim to be a live CI runner. Replay data is labeled illustrative.

## Checks

```bash
npm run typecheck
npm test
npm run build
# Supported fallback when Turbopack cannot start a local CSS worker:
npm run build:webpack
npm run test:e2e
```

E2E tests require the frontend at port 3000, the replay-enabled backend at port 8000, local PostgreSQL, and Chrome. They cover anonymous access rejection, test login, both themes, review interactions, connections, pipeline, logout, and 404 rendering. Unit tests mock OAuth providers; live OAuth consent requires configured provider applications and is not completed by the test suite.

## Search and crawler visibility

Set `SITE_URL` to the public origin before the production build, or use the same public `AUTH_URL`. Canonical links, social cards, structured data, sitemap URLs, and `llms.txt` use this origin. Metadata is generated at build time, so rebuild after changing these variables.

The production landing page is indexable when a non-local public origin is configured. Set `SITE_NOINDEX=true` for staging and preview deployments. Development, localhost, and deployments without a configured origin default to noindex and a blocked robots policy. The sitemap contains only the public landing page.

Workspace pages, sign-in, and APIs use noindex metadata or `X-Robots-Tag` headers. They remain protected by authentication; crawler rules are not access controls. Public search and AI crawlers receive the same server-rendered landing content. `/llms.txt` provides a concise capability summary for assistants that choose to use it, without exposing private reviews or promising search rankings. The social preview image is a static asset and needs no runtime image generation.
