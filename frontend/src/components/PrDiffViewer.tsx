"use client";
import { Fragment, useState } from "react";
import {
  LuCodeXml as Code2,
  LuFileCode2 as FileCode2,
  LuShieldCheck as ShieldCheck,
  LuCopy as Copy,
  LuCheck as Check,
  LuChevronDown as ChevronDown,
  LuGitBranch as GitBranch,
} from "react-icons/lu";
import type { Review, Finding } from "@/lib/types";
import { visibleFindings } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfidenceSlider } from "./ConfidenceSlider";

function FindingCard({ finding }: { finding: Finding }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const f = finding;
  const score = f.verification.calibrated_confidence;
  const label = f.verification.pre_existing
    ? "Pre-existing"
    : f.verification.severity === "important"
      ? "Important"
      : "Nit";
  async function copy() {
    try {
      await navigator.clipboard.writeText(f.candidate.suggested_patch || "");
      setCopyError(false);
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <article
      className={`finding-card ${score >= 80 ? "high-confidence" : "medium-confidence"}`}
      data-testid="finding-card"
    >
      <div className="finding-header">
        <Badge
          variant="outline"
          className={label === "Important" ? "important-badge" : "nit-badge"}
        >
          {label}
        </Badge>
        <span className="finding-cwe">
          {f.candidate.cwe_id || "Correctness"}
        </span>
        <strong>
          {score}
          <small>/100</small>
        </strong>
      </div>
      <h3>{f.candidate.category}</h3>
      <p>{f.candidate.reasoning}</p>
      <div className="verification">
        <ShieldCheck size={15} />
        <div>
          <span>Refutation attempted</span>
          <p>{f.verification.refutation_attempt}</p>
        </div>
      </div>
      {f.candidate.suggested_patch && (
        <details className="patch-details">
          <summary>
            <Code2 size={14} />
            Suggested patch
            <ChevronDown size={13} />
          </summary>
          <pre>
            <code>{f.candidate.suggested_patch}</code>
          </pre>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy patch"}
          </Button>
          {copyError && (
            <span role="alert">Copy unavailable. Select the patch text.</span>
          )}
        </details>
      )}
      <div className="finding-footer">
        <span>
          Agent {f.candidate.source_agent} · L{f.candidate.line_start}
        </span>
        <span>
          {f.posted_to_pr
            ? "Posted to PR"
            : f.tier === "post_to_pr"
              ? "Eligible for PR · not posted"
              : "Logged only"}
        </span>
      </div>
    </article>
  );
}

export function PrDiffViewer({ review }: { review: Review }) {
  const [threshold, setThreshold] = useState(80);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const findings = visibleFindings(review, threshold);
  const bundle = review.result.bundle;
  const files = [...new Set(bundle.hunks.map((h) => h.file))];
  const currentFile =
    activeFile && files.includes(activeFile) ? activeFile : files[0];
  const current = findings.filter((f) => f.candidate.file === currentFile);
  const logged = review.result.findings.filter(
    (f) => f.tier === "dashboard_only",
  ).length;
  const suppressed = review.result.findings.filter(
    (f) => f.tier === "discarded",
  ).length;
  return (
    <div className="review-workspace">
      <aside className="review-context">
        <div className="review-context-heading">Review controls</div>
        <ConfidenceSlider value={threshold} onChange={setThreshold} />
        <p className="fine-print">
          Preview locally. Changing the threshold never republishes a comment.
        </p>
        <div className="review-totals">
          <div>
            <span>Visible findings</span>
            <strong aria-live="polite" data-testid="visible-count">
              {findings.length}
            </strong>
          </div>
          <div>
            <span>Logged only (50–79)</span>
            <strong>{logged}</strong>
          </div>
          <div>
            <span>Suppressed (&lt;50 / refuted)</span>
            <strong>{suppressed}</strong>
          </div>
        </div>
        <div className="review-context-heading files-heading">
          Changed files <span>{files.length}</span>
        </div>
        <nav aria-label="Changed files">
          {files.map((file) => (
            <button
              key={file}
              className={`file-button ${currentFile === file ? "selected" : ""}`}
              aria-pressed={currentFile === file}
              onClick={() => setActiveFile(file)}
            >
              <FileCode2 size={15} />
              <span>{file}</span>
            </button>
          ))}
        </nav>
        <div className="context-note">
          <GitBranch size={15} />
          <div>
            <strong>{bundle.depth_mode} review</strong>
            <span>
              Finders independently scan, then a verifier challenges each
              finding.
            </span>
          </div>
        </div>
      </aside>
      <section className="diff-main">
        <div className="diff-file-header">
          <span>
            <FileCode2 size={16} />
            {currentFile || "No source changes"}
          </span>
          <Badge variant="outline">Unified diff</Badge>
        </div>
        {bundle.hunks
          .filter((h) => h.file === currentFile)
          .map((h, index) => (
            <div className="diff-hunk" key={`${h.file}-${index}`}>
              <div className="hunk-header">{h.header}</div>
              {h.lines.map((line, i) => (
                <Fragment key={i}>
                  <div className={`diff-line ${line.kind}`}>
                    <span>{line.base_line ?? ""}</span>
                    <span>{line.head_line ?? ""}</span>
                    <span className="diff-sign">
                      {line.kind === "addition"
                        ? "+"
                        : line.kind === "deletion"
                          ? "−"
                          : " "}
                    </span>
                    <code>{line.content || " "}</code>
                  </div>
                  {current
                    .filter((f) => line.head_line === f.candidate.line_start)
                    .map((f) => (
                      <div
                        className="inline-annotation"
                        key={f.candidate.finding_id}
                      >
                        <FindingCard finding={f} />
                      </div>
                    ))}
                </Fragment>
              ))}
            </div>
          ))}
        <div className="findings-area">
          <div className="findings-heading">
            <h2>Review findings</h2>
            <span>
              {current.length} visible at {threshold}+
            </span>
          </div>
          {current
            .filter(
              (f) =>
                !bundle.hunks.some(
                  (h) =>
                    h.file === currentFile &&
                    h.lines.some(
                      (line) => line.head_line === f.candidate.line_start,
                    ),
                ),
            )
            .map((f) => (
              <FindingCard key={f.candidate.finding_id} finding={f} />
            ))}
          {!current.length && (
            <div className="no-findings">
              <ShieldCheck size={24} />
              <h3>No findings at this threshold</h3>
              <p>Lower the confidence threshold to inspect logged findings.</p>
            </div>
          )}
          <details className="suppressed-details">
            <summary>Inspect suppressed metadata ({suppressed})</summary>
            {review.result.findings
              .filter((f) => f.tier === "discarded")
              .map((f) => (
                <div key={f.candidate.finding_id}>
                  <strong>
                    {f.candidate.category} ·{" "}
                    {f.verification.calibrated_confidence}/100
                  </strong>
                  <p>{f.verification.refutation_attempt}</p>
                </div>
              ))}
          </details>
        </div>
      </section>
    </div>
  );
}
