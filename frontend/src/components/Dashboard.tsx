"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LuArrowLeft as ArrowLeft,
  LuCircleCheck as CheckCircle2,
  LuGitPullRequest as GitPullRequest,
  LuLoaderCircle as LoaderCircle,
  LuSearch as Search,
  LuShield as Shield,
  LuTriangleAlert as TriangleAlert,
  LuX as X,
} from "react-icons/lu";
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
import { PixelMark } from "./PixelMark";

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
  return (
    <>
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
                <h1>
                  {section === "overview"
                    ? "Workspace overview"
                    : section === "reviews"
                      ? "All reviews"
                      : "Pipeline insights"}
                </h1>
                <p>
                  {section === "overview"
                    ? "Review activity and repository health."
                    : section === "reviews"
                      ? "Track findings and inspect verified pull requests."
                      : "Review performance, finding quality, and inference usage."}
                </p>
              </div>
              <span className="workspace-badge">
                <Shield size={14} />
                Local workspace
              </span>
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
                        {search && (
                          <button
                            className="search-clear"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={12} />
                          </button>
                        )}
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
                      <span className="review-list-label">
                        <GitPullRequest size={16} /> Pull requests{" "}
                        <span className="list-total">{visible.length}</span>
                      </span>
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
                                {new Date(review.created_at).toLocaleDateString(
                                  undefined,
                                  {
                                    month: "short",
                                    day: "numeric",
                                  },
                                )}
                              </p>
                              <span
                                className="mobile-review-status"
                                data-attention={high > 0 || partial}
                              >
                                {partial
                                  ? "Review incomplete"
                                  : high
                                    ? `Ready: ${high} · Logged / suppressed: ${rest}`
                                    : "No findings above threshold"}
                              </span>
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
                        <PixelMark mascot className="empty-mascot" />
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
    </>
  );
}
function PlayIcon() {
  return (
    <span className="replay-symbol">
      <LoaderCircle size={14} />
    </span>
  );
}
