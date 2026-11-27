"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronDown,
  Circle,
  Command,
  GitPullRequest,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Review, Telemetry } from "@/lib/types";
import { api, isPartialReview } from "@/lib/api";
import { RepoHealthCard } from "./RepoHealthCard";
import { TelemetryCharts } from "./TelemetryCharts";
import { DemoControls } from "./DemoControls";
import { PrDiffViewer } from "./PrDiffViewer";

type Section = "overview" | "reviews" | "insights";
export function Dashboard({
  section = "overview",
  reviewId,
}: {
  section?: Section;
  reviewId?: string;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [selected, setSelected] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setLoading(true);
    setError("");
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.reviews(controller.signal),
      api.telemetry(controller.signal),
      reviewId
        ? api.review(reviewId, controller.signal)
        : Promise.resolve(null),
    ])
      .then(([list, metrics, detail]) => {
        if (controller.signal.aborted) return;
        setReviews(list.items);
        setTotal(list.total);
        setTelemetry(metrics);
        setSelected(detail);
        setError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Could not load reviews.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reviewId, revision]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const list = await api.reviews(undefined, reviews.length);
      setReviews((current) => [
        ...current,
        ...list.items.filter(
          (item) => !current.some((review) => review.id === item.id),
        ),
      ]);
      setTotal(list.total);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load more reviews.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const nav = [
    {
      label: "Overview",
      section: "overview",
      href: "/",
      icon: LayoutDashboard,
    },
    {
      label: "All reviews",
      section: "reviews",
      href: "/reviews",
      icon: GitPullRequest,
    },
    {
      label: "Insights",
      section: "insights",
      href: "/insights",
      icon: Activity,
    },
  ];
  const visible = reviews.filter((r) => {
    const c = r.result.bundle.context;
    const matches = `${c.pr_title} ${c.repo_full_name} ${c.pr_number}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const needsAttention =
      isPartialReview(r) ||
      r.result.findings.some((f) => f.tier === "post_to_pr");
    return (
      matches &&
      (filter === "all" ||
        (filter === "attention" && needsAttention) ||
        (filter === "clean" && !needsAttention))
    );
  });
  const currentTitle = reviewId
    ? "Pull request review"
    : section === "overview"
      ? "Overview"
      : section === "reviews"
        ? "All reviews"
        : "Insights";

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <Link href="/" className="brand">
          <div className="brand-mark">
            <Blocks size={21} />
          </div>
          <span>
            TalkBridge<span className="brand-dot">.</span>
          </span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => setShowInfo(!showInfo)}
          aria-expanded={showInfo}
        >
          <span className="workspace-avatar">A</span>
          <span>
            Acme workspace<small>College project</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {showInfo && (
          <div className="workspace-info">
            Local demo workspace. Replay fixtures are illustrative. No account
            or paid API required.
          </div>
        )}
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          {nav.map(({ label, section: item, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${section === item && !reviewId ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {item === "reviews" && (
                <span className="nav-count">{telemetry?.reviews ?? 0}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="nav-label mt-8">Review pipeline</div>
        <div className="pipeline-nav">
          <span>
            <span className="pipeline-node" />
            Deterministic pre-filter
          </span>
          <span>
            <span className="pipeline-node" />
            Independent finders
          </span>
          <span>
            <span className="pipeline-node" />
            Adversarial verifier
          </span>
          <span>
            <span className="pipeline-node" />
            Rank & publish
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="build-card">
            <Sparkles size={17} />
            <h3>Less noise. More signal.</h3>
            <p>Challenge every finding before it reaches your pull request.</p>
            <Link href="/insights">Explore the pipeline</Link>
          </div>
          <div className="workspace-footer">
            <div className="user-avatar">SG</div>
            <div>
              <strong>Demo workspace</strong>
              <span>Local development</span>
            </div>
            <Shield size={15} />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <LayoutDashboard size={19} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{currentTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="system-status">
              <Circle size={8} fill="currentColor" />
              {error
                ? "Service unavailable"
                : loading
                  ? "Connecting"
                  : "Review service connected"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh workspace"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </Button>
            <span className="topbar-divider" />
            <div className="user-avatar small">SG</div>
          </div>
        </header>
        <main className={`main-content ${reviewId ? "detail-content" : ""}`}>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Couldn’t load your workspace</strong>
                <p>{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {loading && (
            <div className="loading-state" aria-label="Loading reviews">
              <Skeleton className="h-8 w-64" />
              <div className="metrics-grid">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton className="h-32" key={i} />
                ))}
              </div>
              <Skeleton className="h-72 w-full" />
            </div>
          )}
          {!loading && !reviewId && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-square" />
                    Code review, with conviction
                  </div>
                  <h1>
                    {section === "overview"
                      ? "Your code. A clearer signal."
                      : section === "reviews"
                        ? "Every review, in one place."
                        : "Understand the review pipeline."}
                  </h1>
                  <p>
                    {section === "overview"
                      ? "A calm workspace for finding what matters, and filtering what doesn’t."
                      : section === "reviews"
                        ? "Explore findings, challenge the reasoning, and review with confidence."
                        : "See where time goes, what gets suppressed, and how context is reused."}
                  </p>
                </div>
                <Badge variant="outline" className="workspace-badge">
                  <Terminal size={12} />
                  College project
                </Badge>
              </div>
              <RepoHealthCard reviews={reviews} telemetry={telemetry} />
              {section !== "insights" && (
                <>
                  <DemoControls
                    onReview={(review) => router.push(`/reviews/${review.id}`)}
                  />
                  <section className="review-list surface">
                    <div className="list-heading">
                      <h2>
                        Pull request reviews <span>{reviews.length}</span>
                      </h2>
                      <div className="list-tools">
                        <div className="search-control">
                          <Search size={15} />
                          <Input
                            placeholder="Search reviews..."
                            aria-label="Search reviews"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                          />
                          <kbd>
                            <Command size={10} />
                          </kbd>
                        </div>
                        <Select
                          value={filter}
                          onValueChange={(value) => {
                            if (value) setFilter(value);
                          }}
                        >
                          <SelectTrigger
                            aria-label="Filter reviews"
                            className="filter-select"
                          >
                            <SelectValue>
                              {filter === "all"
                                ? "All reviews"
                                : filter === "attention"
                                  ? "Needs attention"
                                  : "Clean reviews"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All reviews</SelectItem>
                            <SelectItem value="attention">
                              Needs attention
                            </SelectItem>
                            <SelectItem value="clean">Clean reviews</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="review-table">
                      <div className="table-header">
                        <span>Pull request</span>
                        <span>Findings</span>
                        <span>Depth</span>
                        <span>Profile</span>
                      </div>
                      {visible.map((review) => {
                        const c = review.result.bundle.context;
                        const high = review.result.findings.filter(
                          (f) => f.tier === "post_to_pr",
                        ).length;
                        const rest = review.result.findings.length - high;
                        const partial = isPartialReview(review);
                        return (
                          <Link
                            href={`/reviews/${review.id}`}
                            className="review-row"
                            key={review.id}
                          >
                            <div className="pr-cell">
                              <div
                                className={`pr-icon ${high || partial ? "attention" : "clear"}`}
                              >
                                {partial ? (
                                  <TriangleAlert size={19} />
                                ) : high ? (
                                  <GitPullRequest size={19} />
                                ) : (
                                  <CheckCircle2 size={19} />
                                )}
                              </div>
                              <div>
                                <h3>
                                  {c.pr_title || `Pull request #${c.pr_number}`}
                                </h3>
                                <p>
                                  {c.repo_full_name}
                                  <span>·</span>#{c.pr_number}
                                  <span>·</span>
                                  {new Date(
                                    review.created_at,
                                  ).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </p>
                              </div>
                            </div>
                            <div className="findings-cell">
                              {partial ? (
                                <span className="finding-count">
                                  Partial review
                                </span>
                              ) : high ? (
                                <>
                                  <span className="finding-count">
                                    {high} ready for review
                                  </span>
                                  <small>{rest} logged / suppressed</small>
                                </>
                              ) : (
                                <span className="clear-label">
                                  No high-confidence findings
                                </span>
                              )}
                            </div>
                            <span className="depth-label">
                              {c.pr_number && review.result.bundle.depth_mode}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                review.model_profile === "replay"
                                  ? "replay-badge"
                                  : "live-badge"
                              }
                            >
                              {review.model_profile === "replay"
                                ? "Replay"
                                : "Base 8B"}
                            </Badge>
                          </Link>
                        );
                      })}
                      {!visible.length && (
                        <div className="empty-state">
                          <GitPullRequest size={28} />
                          <h3>
                            {reviews.length
                              ? "No matching reviews"
                              : "Your next review starts here"}
                          </h3>
                          <p>
                            {reviews.length
                              ? "Try a different search or filter."
                              : "Replay a sample above, or connect your live review pipeline."}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="table-footer">
                      {reviews.length < total && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={loadMore}
                          disabled={loadingMore}
                        >
                          {loadingMore ? "Loading..." : "Load more"}
                        </Button>
                      )}
                      <span>
                        {visible.length} matching · {reviews.length} of {total}{" "}
                        loaded
                      </span>
                      <span>
                        <Shield size={12} />
                        Checks stay neutral. You decide what ships.
                      </span>
                    </div>
                  </section>
                </>
              )}
              {section !== "reviews" && (
                <TelemetryCharts telemetry={telemetry} reviews={reviews} />
              )}
              <footer className="workspace-caption">
                TalkBridge <span>·</span> Deterministic context. Independent
                finders. Adversarial verification.
              </footer>
            </>
          )}
          {!loading && reviewId && selected && (
            <>
              <Link href="/reviews" className="back-link">
                <ArrowLeft size={14} />
                All reviews
              </Link>
              <div className="detail-heading">
                <div className="detail-title-row">
                  <div className="pr-icon attention">
                    <GitPullRequest size={22} />
                  </div>
                  <h1>
                    {selected.result.bundle.context.pr_title ||
                      "Pull request review"}
                  </h1>
                  <Badge
                    variant="outline"
                    className={
                      selected.model_profile === "replay"
                        ? "replay-badge"
                        : "live-badge"
                    }
                  >
                    {selected.model_profile === "replay" ? "Replay" : "Base 8B"}
                  </Badge>
                </div>
                <div className="detail-meta">
                  <span>{selected.result.bundle.context.repo_full_name}</span>
                  <span>#{selected.result.bundle.context.pr_number}</span>
                  <span>
                    {selected.result.bundle.context.pr_author || "Contributor"}
                  </span>
                  <span>{selected.result.bundle.depth_mode} review</span>
                </div>
              </div>
              {selected.model_profile === "replay" && (
                <div className="replay-notice">
                  <PlayIcon />
                  <span>
                    <strong>Recorded demo review.</strong> Findings and timings
                    are illustrative. Nothing was posted to GitHub.
                  </span>
                </div>
              )}
              {(isPartialReview(selected) ||
                !!selected.result.publication?.warnings.length) && (
                <div className="error-banner">
                  <TriangleAlert size={16} />
                  <span>
                    {isPartialReview(selected)
                      ? "Partial review. "
                      : "Publication notice. "}
                    {selected.result.errors.map((e) => e.message).join(" ")}{" "}
                    {selected.result.bundle.warnings.join(" ")}{" "}
                    {selected.result.publication?.warnings.join(" ")}
                  </span>
                </div>
              )}
              <PrDiffViewer key={selected.id} review={selected} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function PlayIcon() {
  return (
    <span className="replay-symbol">
      <LoaderCircle size={14} />
    </span>
  );
}
