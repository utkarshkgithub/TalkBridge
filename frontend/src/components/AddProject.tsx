"use client";

import { useEffect, useState } from "react";
import { SiGithub } from "react-icons/si";
import {
  LuCheck as Check,
  LuExternalLink as ExternalLink,
  LuFolderGit2 as FolderGit2,
  LuPlus as Plus,
  LuRefreshCw as RefreshCw,
} from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { GitHubInstallation } from "@/lib/auth/store";

export type AddProjectConfig = {
  githubConnected: boolean;
  githubEnabled: boolean;
  appSlug: string;
  installations: GitHubInstallation[];
};

type RepoItem = { id: string; name: string; private: boolean };

function installSettingsUrl(inst: GitHubInstallation) {
  return inst.account_type === "Organization" && inst.account_login
    ? `https://github.com/organizations/${encodeURIComponent(inst.account_login)}/settings/installations/${inst.installation_id}`
    : `https://github.com/settings/installations/${inst.installation_id}`;
}

export function AddProject({
  githubConnected,
  githubEnabled,
  appSlug,
  installations: initialInstallations,
}: AddProjectConfig) {
  const [installations, setInstallations] =
    useState<GitHubInstallation[]>(initialInstallations);
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(
    githubConnected && initialInstallations.some((i) => i.status === "active"),
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const hasActiveInstall = installations.some((i) => i.status === "active");

  useEffect(() => {
    if (!githubConnected || !hasActiveInstall) return;
    const controller = new AbortController();
    let active = true;
    fetch("/api/auth/repositories/github", { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || "Could not load added projects.");
        return data;
      })
      .then((data) => {
        if (active) setRepos(Array.isArray(data.items) ? data.items : []);
      })
      .catch((e) => {
        if (active && e.name !== "AbortError")
          setError(
            e instanceof Error ? e.message : "Could not load added projects.",
          );
      })
      .finally(() => {
        if (active) setLoadingRepos(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [githubConnected, hasActiveInstall, revision]);

  async function sync() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/auth/installations/sync", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sync failed.");
      const next = Array.isArray(data.items)
        ? (data.items as GitHubInstallation[])
        : [];
      setInstallations(next);
      if (next.some((i) => i.status === "active")) {
        setLoadingRepos(true);
        setRepos([]);
        setRevision((n) => n + 1);
      } else {
        setRepos([]);
        setLoadingRepos(false);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not sync GitHub App installations.",
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section
      className="add-project surface"
      aria-labelledby="add-project-heading"
    >
      <div className="add-project-top">
        <div className="add-project-intro">
          <span className="add-project-icon">
            <FolderGit2 size={18} />
          </span>
          <div>
            <h2 id="add-project-heading">Add project</h2>
            <p>
              {!githubConnected
                ? "Connect GitHub to select repositories where TalkBridge should review pull requests."
                : hasActiveInstall
                  ? "Pull requests on these repositories automatically trigger TalkBridge reviews."
                  : "Install the TalkBridge GitHub App on specific repositories, then sync."}
            </p>
          </div>
        </div>
        <div className="add-project-actions">
          {!githubConnected ? (
            <form method="post" action="/api/auth/connect/github">
              <Button type="submit" size="sm" disabled={!githubEnabled}>
                <SiGithub size={14} /> Connect GitHub
              </Button>
            </form>
          ) : (
            <>
              <a
                className={buttonVariants({ size: "sm" })}
                href={`https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`}
                target="_blank"
                rel="noreferrer"
              >
                <Plus size={14} /> Add repository
              </a>
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={sync}
              >
                <RefreshCw
                  size={14}
                  className={syncing ? "animate-spin" : undefined}
                />
                {syncing ? "Syncing..." : "Sync"}
              </Button>
            </>
          )}
        </div>
      </div>

      {!githubEnabled && !githubConnected && (
        <p className="fine-print">
          GitHub App OAuth credentials are not configured yet in this
          environment.
        </p>
      )}

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {!hasActiveInstall ? (
        <ol className="add-project-steps">
          <li className={githubConnected ? "done" : "current"}>
            <span className="step-dot">
              {githubConnected ? <Check size={12} /> : "1"}
            </span>
            <div>
              <strong>Connect GitHub</strong>
              <span>Verify your GitHub identity</span>
            </div>
          </li>
          <li className={githubConnected ? "current" : undefined}>
            <span className="step-dot">2</span>
            <div>
              <strong>Select repositories</strong>
              <span>Install on chosen repos</span>
            </div>
          </li>
          <li>
            <span className="step-dot">3</span>
            <div>
              <strong>Open a PR</strong>
              <span>Reviews & checks post automatically</span>
            </div>
          </li>
        </ol>
      ) : loadingRepos ? (
        <div
          className="add-project-skeletons"
          role="status"
          aria-label="Loading added projects"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : repos.length ? (
        <div className="project-grid">
          {repos.map((repo) => (
            <a
              key={repo.id}
              className="project-chip"
              href={`https://github.com/${repo.name}`}
              target="_blank"
              rel="noreferrer"
            >
              <SiGithub size={14} />
              <strong>{repo.name}</strong>
              <Badge variant="outline">
                {repo.private ? "Private" : "Public"}
              </Badge>
              <ExternalLink size={12} className="project-chip-link" />
            </a>
          ))}
        </div>
      ) : (
        <p className="fine-print">
          Installation linked, but no repositories are currently selected. Use
          &ldquo;Select repos&rdquo; below to pick repositories.
        </p>
      )}

      {installations.length > 0 && (
        <div className="add-project-footer">
          {installations.map((inst) => (
            <div className="install-meta-row" key={inst.installation_id}>
              <span>
                <strong>@{inst.account_login || inst.installation_id}</strong> ·{" "}
                {inst.status} · {inst.daily_count}/{inst.daily_limit} reviews
                today
              </span>
              <a
                href={installSettingsUrl(inst)}
                target="_blank"
                rel="noreferrer"
              >
                Select repos <ExternalLink size={12} />
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
