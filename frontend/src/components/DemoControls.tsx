"use client";
import { useState } from "react";
import { Play, Radio, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { Review } from "@/lib/types";

export function DemoControls({
  onReview,
}: {
  onReview: (review: Review) => void;
}) {
  const [fixture, setFixture] = useState("auth_sqli_pr");
  const [busy, setBusy] = useState<"replay" | "live" | null>(null);
  const [error, setError] = useState("");
  async function run(mode: "replay" | "live") {
    setBusy(mode);
    setError("");
    try {
      onReview(await api[mode](fixture));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed. Try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="demo-panel" aria-label="Demo controls">
      <div className="demo-panel-heading">
        <div className="demo-glyph">
          <Play size={16} />
        </div>
        <div>
          <h3>See the signal, skip the setup.</h3>
          <p>Explore a recorded review. No GPU or internet needed.</p>
        </div>
      </div>
      <div className="demo-actions">
        <Select
          value={fixture}
          onValueChange={(value) => {
            if (value) setFixture(value);
          }}
        >
          <SelectTrigger
            className="fixture-select"
            aria-label="Review scenario"
          >
            <SelectValue>
              {fixture === "auth_sqli_pr"
                ? "Authentication & SQL"
                : fixture === "logic_edge_pr"
                  ? "Checkout logic"
                  : "Clean pull request"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auth_sqli_pr">Authentication & SQL</SelectItem>
            <SelectItem value="logic_edge_pr">Checkout logic</SelectItem>
            <SelectItem value="clean_small_pr">Clean pull request</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => run("replay")} disabled={!!busy}>
          {busy === "replay" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Play />
          )}
          Replay review
        </Button>
        <Button variant="outline" onClick={() => run("live")} disabled={!!busy}>
          {busy === "live" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Radio />
          )}
          Run live
        </Button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine-print">
        Replay is illustrative and never posts to GitHub. Live requires a
        configured model server.
      </p>
    </section>
  );
}
