"use client";
import { useEffect, useState } from "react";
import {
  LuBraces as Braces,
  LuGitPullRequest as GitPullRequest,
  LuScanSearch as ScanSearch,
  LuShieldCheck as ShieldCheck,
  LuCombine as Combine,
  LuSend as Send,
  LuRefreshCw as RefreshCw,
} from "react-icons/lu";
import { PixelMark } from "./PixelMark";
import { PageSkeleton } from "./PageSkeleton";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { api } from "@/lib/api";
import type { Review } from "@/lib/types";
const stages = [
  {
    icon: Braces,
    title: "Prepare context",
    key: "stage0",
    description:
      "Clean the diff, extract functions and callers, then run deterministic checks.",
  },
  {
    icon: ScanSearch,
    title: "Independent finders",
    key: "stage1",
    description:
      "Specialist agents inspect security, logic, repository rules, and caller contracts.",
  },
  {
    icon: ShieldCheck,
    title: "Adversarial verifier",
    key: "stage2",
    description:
      "Try to disprove each candidate before assigning calibrated confidence.",
  },
  {
    icon: Combine,
    title: "Dedupe & rank",
    key: "stage3",
    description:
      "Merge overlapping findings and apply confidence and severity thresholds.",
  },
  {
    icon: Send,
    title: "Publish review",
    key: "stage4",
    description:
      "Eligible findings can be published to GitHub. Recorded replays never post.",
  },
];
export function Pipeline() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .reviews(controller.signal)
      .then((list) => {
        setReviews(list.items);
        setId((current) =>
          list.items.some((r) => r.id === current)
            ? current
            : list.items[0]?.id || "",
        );
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const selected = reviews.find((r) => r.id === id);
  const telemetry = selected?.result.telemetry;
  if (loading) return <PageSkeleton kind="pipeline" />;
  return (
    <>
      <main className="main-content">
        <div className="page-heading">
          <div>
            <h1>Review pipeline</h1>
            <p>
              Follow the path from a code change to an evidence-backed finding.
            </p>
          </div>
          <Button
            variant="outline"
            aria-label="Refresh pipeline"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          >
            <RefreshCw size={14} />
          </Button>
        </div>
        <div className="pipeline-toolbar">
          <Select
            value={id}
            onValueChange={(value) => {
              if (value) setId(value);
            }}
          >
            <SelectTrigger
              aria-label="Pipeline review"
              disabled={!reviews.length}
            >
              <SelectValue>
                {selected?.result.bundle.context.pr_title ||
                  "No recorded reviews"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {reviews.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.result.bundle.context.pr_title || r.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline">
            {selected?.model_profile === "replay"
              ? "Recorded replay"
              : selected
                ? "Recorded review"
                : "Pipeline architecture"}
          </Badge>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <section className="workflow-canvas" aria-label="Review pipeline flow">
          <div className="workflow-source">
            <GitPullRequest size={16} />
            <span>Pull request</span>
          </div>
          <div className="workflow-stages">
            {stages.map(({ icon: Icon, title, key, description }, index) => (
              <article key={key} className="workflow-node">
                <div className="workflow-node-header">
                  <Icon size={16} />
                  <span>Stage {index}</span>
                </div>
                <h2>{title}</h2>
                <p>{description}</p>
                <div className="workflow-node-footer">
                  {loading ? (
                    "Loading..."
                  ) : telemetry ? (
                    <>
                      <span>Recorded timing</span>
                      <strong>
                        {Math.round(telemetry.stage_ms[key] || 0)} ms
                      </strong>
                    </>
                  ) : (
                    "Awaiting a recorded review"
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        <p className="workflow-caption">
          This is the review architecture with recorded timings, not a live CI
          run. Replay timings are illustrative.
        </p>
        <div className="pipeline-explainer">
          <section className="surface">
            <h2>Depth selects the finders</h2>
            <dl>
              <div>
                <dt>Quick</dt>
                <dd>Security finder (A)</dd>
              </div>
              <div>
                <dt>Standard</dt>
                <dd>Security, logic, and repository rules (A, B, C)</dd>
              </div>
              <div>
                <dt>Deep</dt>
                <dd>All finders, including caller contracts (A, B, C, D)</dd>
              </div>
            </dl>
          </section>
          <section className="surface">
            <h2>Confidence controls visibility</h2>
            <dl>
              <div>
                <dt>80–100</dt>
                <dd>Eligible for PR publication</dd>
              </div>
              <div>
                <dt>50–79</dt>
                <dd>Logged in the dashboard</dd>
              </div>
              <div>
                <dt>0–49</dt>
                <dd>Suppressed metadata</dd>
              </div>
            </dl>
          </section>
        </div>
        {!selected && !loading && (
          <div className="empty-state">
            <PixelMark mascot className="empty-mascot" />
            <h3>No pipeline runs yet</h3>
            <p>Open a pull request on an installed repository to inspect stage timings.</p>
          </div>
        )}
      </main>
    </>
  );
}
