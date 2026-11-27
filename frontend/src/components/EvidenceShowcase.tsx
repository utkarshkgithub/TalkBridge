"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  LuShieldCheck,
  LuBraces,
  LuCircleCheck,
  LuFileCode2,
} from "react-icons/lu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { PixelMark } from "./PixelMark";
const examples = [
  {
    id: "security",
    label: "Security findings",
    icon: LuShieldCheck,
    title: "SQL query interpolates untrusted input",
    file: "auth/login.py",
    score: "92/100",
    summary: "Untrusted input reaches a SQL query without parameter binding.",
    reason:
      "Checked for parameter binding and input validation. Neither appears before cursor.execute.",
    patch: 'cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))',
    footer: "Security & OWASP · Agent A",
  },
  {
    id: "logic",
    label: "Logic & edge cases",
    icon: LuBraces,
    title: "Discount is accepted without bounds",
    file: "billing/discount.py",
    score: "88/100",
    summary:
      "A client-controlled percentage above 100 produces a negative order total.",
    reason:
      "No validation constrains the discount percentage before apply_discount.",
    patch:
      'if not 0 <= percentage <= 100:\n    raise ValueError("Invalid discount percentage")',
    footer: "Logic & edge cases · Agent B",
  },
  {
    id: "clean",
    label: "Clean reviews",
    icon: LuCircleCheck,
    title: "Handle empty names in profile cards",
    file: "Clean sample",
    score: "No findings",
    summary: "This recorded clean replay contains no findings to surface.",
    reason:
      "A clean review leaves room for your code. This sample contains no recorded candidates; it is not a security guarantee.",
    patch: "",
    footer: "Clean replay · No findings recorded",
  },
];
function subscribe(listener: () => void) {
  const query = window.matchMedia("(max-width: 1000px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function EvidenceShowcase() {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(max-width: 1000px)").matches,
    () => false,
  );
  return (
    <section className="evidence-section" id="review-preview">
      <div className="evidence-section-heading">
        <div>
          <span className="pixel-eyebrow">FOLLOW THE EVIDENCE</span>
          <h2>See what the review found.</h2>
        </div>
        <Link className="secondary-link" href="/login">
          Try a recorded review
        </Link>
      </div>
      <Tabs
        defaultValue="security"
        orientation={compact ? "horizontal" : "vertical"}
        className="evidence-showcase"
      >
        <TabsList aria-label="Review examples" className="evidence-tabs">
          {examples.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id}>
              <Icon size={24} />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {examples.map((example) => (
          <TabsContent
            key={example.id}
            value={example.id}
            className="evidence-panel"
          >
            <div className="evidence-facts">
              <article className="evidence-summary">
                <div className="evidence-file">
                  <LuFileCode2 size={16} />
                  {example.file}
                </div>
                <span className="example-label">ILLUSTRATIVE REPLAY</span>
                <h3>{example.title}</h3>
                <p>{example.summary}</p>
                <strong className="evidence-score">{example.score}</strong>
              </article>
              <article className="evidence-patch">
                <span className="pixel-eyebrow">
                  {example.patch ? "SUGGESTED CHANGE" : "NOTHING TO SURFACE"}
                </span>
                {example.patch ? (
                  <pre>
                    <code>{example.patch}</code>
                  </pre>
                ) : (
                  <div className="evidence-clean">
                    <PixelMark mascot />
                    <p>No patch needed for this sample.</p>
                  </div>
                )}
                <p>Recorded example. Nothing posted to GitHub.</p>
              </article>
            </div>
            <article className="evidence-reason">
              <span className="pixel-eyebrow">
                {example.patch ? "REFUTATION ATTEMPTED" : "A QUIETER REVIEW"}
              </span>
              <p>{example.reason}</p>
              <footer>
                <PixelMark />
                <span>{example.footer}</span>
              </footer>
            </article>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
