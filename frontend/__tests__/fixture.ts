import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Review, Telemetry } from "@/lib/types";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../backend/app/storage/replays/auth_sqli_pr.json"),
    "utf8",
  ),
);
export const review: Review = {
  id: "demo-auth_sqli_pr",
  created_at: "2026-11-27T12:00:00Z",
  model_profile: "replay",
  result: fixture.result,
};
export const telemetry: Telemetry = {
  reviews: 1,
  candidates: 3,
  posted: 0,
  suppression_rate: 2 / 3,
  severity_counts: { Important: 1, Nit: 1, "Pre-existing": 0 },
  stage_ms: review.result.telemetry.stage_ms,
  prompt_tokens: 6400,
  cached_tokens: 3200,
  cache_hit_ratio: 0.5,
  estimated_cost_usd: 0,
  model_profiles: ["replay"],
};
