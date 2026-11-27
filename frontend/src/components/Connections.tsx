"use client";
import { SiGithub, SiGitlab, SiBitbucket } from "react-icons/si";
import { useEffect, useState } from "react";
import {
  LuGitBranch as GitBranch,
  LuLink2 as Link2,
  LuLockKeyhole as LockKeyhole,
  LuRefreshCw as RefreshCw,
} from "react-icons/lu";
import { PixelMark } from "./PixelMark";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type { Connection } from "@/lib/auth/store";
const definitions = [
  {
    id: "github",
    name: "GitHub",
    description:
      "Connect your GitHub account to browse public and private repositories.",
    permissions:
      "Profile and repository access. Automated PR reviews use your separately configured GitHub App.",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Connect GitLab.com and browse projects you belong to.",
    permissions:
      "Read-only profile, API, and repository access. Automated merge request reviews are not available yet.",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description: "Connect Bitbucket Cloud and browse your repositories.",
    permissions:
      "Permissions follow your OAuth consumer configuration. Automated PR reviews are not available yet.",
  },
];
export function Connections({
  initial,
  providers,
  message,
}: {
  initial: Connection[];
  providers: Record<string, boolean>;
  message?: string;
}) {
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.provider || "github");
  const [repos, setRepos] = useState<
    { id: string; name: string; private: boolean }[]
  >([]);
  const [loading, setLoading] = useState(initial.length > 0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState("");
  const connected = items.some((i) => i.provider === selected);
  useEffect(() => {
    const controller = new AbortController();
    if (!connected) return;
    let active = true;
    fetch(`/api/auth/repositories/${selected}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || "Could not load repositories.");
        return data;
      })
      .then((data) => {
        if (active) setRepos(data.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected, connected, revision]);
  async function disconnect(provider: string) {
    setBusy(provider);
    setError("");
    try {
      const response = await fetch(`/api/auth/disconnect/${provider}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data.connections);
      if (selected === provider) {
        setRepos([]);
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <main className="main-content">
        <div className="page-heading">
          <div>
            <h1>Connections</h1>
            <p>
              Authorize your accounts. Keep repository access under your
              control.
            </p>
          </div>
          <Badge variant="outline">{items.length} connected</Badge>
        </div>
        {message && (
          <div className="connection-notice" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="provider-grid">
          {definitions.map((provider) => {
            const account = items.find((i) => i.provider === provider.id);
            return (
              <section className="provider-card" key={provider.id}>
                <div className="provider-card-top">
                  <span className={`provider-icon ${provider.id}`}>
                    {provider.id === "github" ? (
                      <SiGithub size={24} />
                    ) : provider.id === "gitlab" ? (
                      <SiGitlab size={24} />
                    ) : (
                      <SiBitbucket size={24} />
                    )}
                  </span>
                  <div>
                    <h2>{provider.name}</h2>
                    <span
                      className={
                        account ? "connected-label" : "disconnected-label"
                      }
                    >
                      {account
                        ? `Connected as ${account.account}`
                        : "Not connected"}
                    </span>
                  </div>
                </div>
                <p>{provider.description}</p>
                <details className="provider-permissions">
                  <summary>Access & capabilities</summary>
                  <p>{provider.permissions}</p>
                </details>
                <div className="provider-card-actions">
                  {account ? (
                    <Button
                      variant="outline"
                      disabled={busy === provider.id}
                      onClick={() => disconnect(provider.id)}
                    >
                      {busy === provider.id ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  ) : (
                    <form
                      method="post"
                      action={`/api/auth/connect/${provider.id}`}
                    >
                      <Button
                        type="submit"
                        className="connect-button"
                        disabled={!providers[provider.id]}
                      >
                        <Link2 size={14} /> Connect {provider.name}
                      </Button>
                    </form>
                  )}
                  {!providers[provider.id] && (
                    <span className="setup-label">OAuth setup required</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <section className="repository-browser surface">
          <div className="list-heading">
            <h2>Repositories</h2>
            <div className="list-tools">
              <Select
                value={selected}
                onValueChange={(value) => {
                  if (value && value !== selected) {
                    setSelected(value);
                    setLoading(items.some((item) => item.provider === value));
                    setError("");
                    setRepos([]);
                  }
                }}
              >
                <SelectTrigger aria-label="Repository provider">
                  <SelectValue>
                    {definitions.find((p) => p.id === selected)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {definitions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                aria-label="Refresh repositories"
                disabled={!connected || loading}
                onClick={() => {
                  setLoading(true);
                  setError("");
                  setRepos([]);
                  setRevision((n) => n + 1);
                }}
              >
                <RefreshCw size={14} />
              </Button>
            </div>
          </div>
          {!connected ? (
            <div className="empty-state">
              <PixelMark mascot className="empty-mascot" />
              <h3>No repositories connected</h3>
              <p>
                Connect {definitions.find((p) => p.id === selected)?.name} above
                to load repositories you can access.
              </p>
            </div>
          ) : loading ? (
            <div
              className="skeleton-repositories"
              role="status"
              aria-label="Loading repositories"
            >
              {[0, 1, 2].map((n) => (
                <Skeleton className="mt-4 h-10 w-full" key={n} />
              ))}
            </div>
          ) : repos.length ? (
            <>
              <div className="repo-list">
                {repos.map((repo) => (
                  <div className="repository-item" key={repo.id}>
                    <GitBranch size={16} />
                    <strong>{repo.name}</strong>
                    <Badge variant="outline">
                      {repo.private ? "Private" : "Public"}
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="repository-note">
                Showing up to 30 recently updated repositories. Connecting an
                account does not install webhooks or enable automated reviews.
              </p>
            </>
          ) : (
            <div className="empty-state">
              <PixelMark mascot className="empty-mascot" />
              <h3>
                {error
                  ? "Repositories could not be loaded"
                  : "No accessible repositories"}
              </h3>
              <p>
                {error
                  ? "Retry or reconnect your provider account."
                  : "Check the permissions granted to TalkBridge in your provider settings."}
              </p>
            </div>
          )}
        </section>
        <div className="connection-security">
          <LockKeyhole size={16} />
          <p>
            Tokens are encrypted on the server. Disconnecting removes
            TalkBridge’s stored credentials. Revoke the app in your provider’s
            settings to remove the authorization there.
          </p>
        </div>
      </main>
    </>
  );
}
