import type { Telemetry, Review } from "@/lib/types";
import { healthScore, isPartialReview } from "@/lib/api";
import {
  LuActivity as Activity,
  LuZap as Zap,
  LuCircleHelp as CircleHelp,
} from "react-icons/lu";

export function TelemetryCharts({
  telemetry,
  reviews,
}: {
  telemetry: Telemetry | null;
  reviews: Review[];
}) {
  const stages = ["Pre-filter", "Finders", "Verifier", "Ranking", "Publisher"];
  const max = Math.max(1, ...Object.values(telemetry?.stage_ms ?? {}));
  const history = reviews
    .filter((review) => !isPartialReview(review))
    .reverse()
    .slice(-12);
  const points = history
    .map(
      (r, i) =>
        `${20 + i * (560 / Math.max(history.length - 1, 1))},${150 - healthScore(r) * 1.1}`,
    )
    .join(" ");
  const replay = telemetry?.model_profiles.includes("replay");
  return (
    <div className="charts-grid">
      <section className="surface chart-panel">
        <div className="panel-title">
          <span>
            <Activity size={16} /> Review health over time
          </span>
          <span className="subtle-label">{history.length} reviews</span>
        </div>
        {history.length ? (
          <svg
            className="health-chart"
            viewBox="0 0 600 180"
            role="img"
            aria-label="Review health trend"
          >
            <defs>
              <linearGradient id="health-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-color)"
                  stopOpacity=".12"
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-color)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            {[40, 95, 150].map((y) => (
              <line
                key={y}
                x1="20"
                x2="580"
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 5"
              />
            ))}
            <polygon
              points={`20,165 ${points} ${20 + (history.length - 1) * (560 / Math.max(history.length - 1, 1))},165`}
              fill="url(#health-fill)"
            />
            <polyline
              points={points}
              fill="none"
              stroke="var(--chart-color)"
              strokeWidth="2.5"
            />
            {history.map((r, i) => (
              <circle
                key={r.id}
                cx={20 + i * (560 / Math.max(history.length - 1, 1))}
                cy={150 - healthScore(r) * 1.1}
                r="4"
                fill="var(--chart-color)"
              >
                <title>
                  PR #{r.result.bundle.context.pr_number}: {healthScore(r)}/100
                </title>
              </circle>
            ))}
          </svg>
        ) : (
          <div className="chart-empty">Complete a review to see the trend.</div>
        )}
        <div className="chart-caption">
          <span>Earlier reviews</span>
          <span>Most recent</span>
        </div>
        <p className="fine-print">
          A heuristic workspace score, not a security certification.
        </p>
      </section>
      <section className="surface chart-panel">
        <div className="panel-title">
          <span>
            <Zap size={16} /> Pipeline latency
          </span>
          <span className="subtle-label">Average / review</span>
        </div>
        <div className="stage-bars" aria-label="Stage latency chart">
          {stages.map((label, i) => {
            const value = telemetry?.stage_ms[`stage${i}`] ?? 0;
            return (
              <div className="stage-row" key={label}>
                <span>{label}</span>
                <div>
                  <i
                    style={{
                      width: `${Math.max(value ? 2 : 0, (value / max) * 100)}%`,
                    }}
                  />
                </div>
                <span>{Math.round(value)} ms</span>
              </div>
            );
          })}
        </div>
        <div className="cache-stat">
          <span>Prefix cache hit ratio</span>
          <strong>
            {telemetry?.cache_hit_ratio == null
              ? "Unavailable"
              : `${Math.round(telemetry.cache_hit_ratio * 100)}%`}
          </strong>
        </div>
        <p className="fine-print">
          {replay
            ? "Replay timings and cache counts are illustrative."
            : "Observed counts where exposed by the inference server."}
        </p>
      </section>
      <section
        className="surface severity-panel"
        aria-label="Finding severity distribution"
      >
        <div className="panel-title">
          <span>Verified finding mix</span>
          <span className="subtle-label">Suppressed findings excluded</span>
        </div>
        <div className="severity-grid">
          {["Important", "Nit", "Pre-existing"].map((label) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{telemetry?.severity_counts[label] ?? 0}</strong>
              <div className="severity-track">
                <i
                  style={{
                    width: `${
                      ((telemetry?.severity_counts[label] ?? 0) /
                        Math.max(
                          1,
                          Object.values(
                            telemetry?.severity_counts ?? {},
                          ).reduce((a, b) => a + b, 0),
                        )) *
                      100
                    }%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="surface cost-panel">
        <CircleHelp size={17} />
        <div>
          <h3>Inference cost</h3>
          <p>
            ${(telemetry?.estimated_cost_usd ?? 0).toFixed(2)} estimated API
            cost. Hardware and hosting excluded. External API comparison is not
            configured.
          </p>
        </div>
        <span className="subtle-label">
          {replay ? "Replay data" : "Local model"}
        </span>
      </section>
    </div>
  );
}
