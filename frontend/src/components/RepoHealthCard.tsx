import type { Review, Telemetry } from "@/lib/types";
import { healthScore, isPartialReview } from "@/lib/api";
import {
  ShieldCheck,
  ScanLine,
  SlidersHorizontal,
  GitPullRequest,
} from "lucide-react";

export function RepoHealthCard({
  reviews,
  telemetry,
}: {
  reviews: Review[];
  telemetry: Telemetry | null;
}) {
  const complete = reviews.filter((review) => !isPartialReview(review));
  const health = complete.length
    ? Math.round(
        complete.reduce((sum, r) => sum + healthScore(r), 0) / complete.length,
      )
    : null;
  const surfaced = reviews.reduce(
    (sum, r) =>
      sum + r.result.findings.filter((f) => f.tier === "post_to_pr").length,
    0,
  );
  const values = [
    {
      title: "Review health",
      value: health === null ? "N/A" : `${health}`,
      suffix: "/100",
      note: "Heuristic based on finding severity",
      icon: ShieldCheck,
      tone: "green",
    },
    {
      title: "Findings surfaced",
      value: surfaced,
      note: "At the 80+ publication threshold",
      icon: ScanLine,
      tone: "purple",
    },
    {
      title: "Noise suppressed",
      value: telemetry
        ? `${Math.round(telemetry.suppression_rate * 100)}%`
        : "N/A",
      note: "Candidates kept below PR threshold",
      icon: SlidersHorizontal,
      tone: "blue",
    },
    {
      title: "Reviews recorded",
      value: telemetry?.reviews ?? 0,
      note: `${reviews.filter((r) => r.model_profile === "replay").length} illustrative replays in this view`,
      icon: GitPullRequest,
      tone: "amber",
    },
  ];
  return (
    <section aria-label="Repository health" className="metrics-grid">
      {values.map(({ title, value, suffix, note, icon: Icon, tone }) => (
        <article className="metric" key={title}>
          <div className="flex items-center justify-between">
            <p>{title}</p>
            <Icon size={16} className={`tone-${tone}`} />
          </div>
          <div className="metric-value">
            {value}
            <span>{suffix}</span>
          </div>
          <p className="metric-note">{note}</p>
        </article>
      ))}
    </section>
  );
}
