import type { Review, ReviewList, Telemetry } from "./types";

async function request<T>(
  path: string,
  method = "GET",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    method,
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : "The review service could not complete this request.",
    );
  }
  return response.json() as Promise<T>;
}
export const api = {
  reviews: (signal?: AbortSignal, offset = 0) =>
    request<ReviewList>(`/reviews?limit=100&offset=${offset}`, "GET", signal),
  review: (id: string, signal?: AbortSignal) =>
    request<Review>(`/reviews/${encodeURIComponent(id)}`, "GET", signal),
  telemetry: (signal?: AbortSignal) =>
    request<Telemetry>("/telemetry/summary", "GET", signal),
};
export function visibleFindings(review: Review, threshold: number) {
  return review.result.findings.filter(
    (f) =>
      f.verification.calibrated_confidence >= threshold &&
      f.verification.verdict !== "refuted",
  );
}
export function healthScore(review: Review) {
  return Math.max(
    0,
    100 -
      review.result.findings.reduce(
        (sum, f) =>
          sum +
          (f.tier === "post_to_pr" ? 20 : f.tier === "dashboard_only" ? 5 : 0),
        0,
      ),
  );
}

export function isPartialReview(review: Review) {
  return (
    review.result.errors.length > 0 ||
    review.result.bundle.warnings.length > 0 ||
    review.result.bundle.sast_status !== "completed"
  );
}
