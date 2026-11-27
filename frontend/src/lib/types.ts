export type DiffLine = {
  kind: "addition" | "deletion" | "context";
  content: string;
  head_line: number | null;
  base_line: number | null;
  github_position: number;
};
export type Finding = {
  candidate: {
    finding_id: string;
    file: string;
    line_start: number;
    line_end: number;
    source_agent: string;
    category: string;
    cwe_id: string | null;
    confidence: number;
    reasoning: string;
    suggested_patch: string | null;
    unit_test: string | null;
  };
  verification: {
    verdict: "confirmed" | "refuted" | "uncertain";
    refutation_attempt: string;
    calibrated_confidence: number;
    severity: "important" | "nit";
    pre_existing: boolean;
  };
  tier: "post_to_pr" | "dashboard_only" | "discarded";
  posted_to_pr: boolean;
};
export type Review = {
  id: string;
  created_at: string;
  model_profile: "base_8b" | "replay";
  result: {
    bundle: {
      context: {
        repo_full_name: string;
        pr_number: number;
        pr_title: string;
        pr_author: string;
        head_sha: string;
      };
      depth_mode: "quick" | "standard" | "deep";
      hunks: { file: string; header: string; lines: DiffLine[] }[];
      warnings: string[];
      sast_status: string;
    };
    findings: Finding[];
    telemetry: {
      stage_ms: Record<string, number>;
      prompt_tokens: number;
      cached_tokens: number;
      estimated_cost_usd: number;
    };
    errors: { message: string }[];
    publication: { dry_run: boolean; warnings: string[] } | null;
  };
};
export type ReviewList = {
  items: Review[];
  total: number;
  limit: number;
  offset: number;
};
export type Telemetry = {
  reviews: number;
  candidates: number;
  posted: number;
  suppression_rate: number;
  severity_counts: Record<string, number>;
  stage_ms: Record<string, number>;
  prompt_tokens: number;
  cached_tokens: number;
  cache_hit_ratio: number | null;
  estimated_cost_usd: number;
  model_profiles: string[];
};
