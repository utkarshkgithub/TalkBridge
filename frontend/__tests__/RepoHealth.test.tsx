import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Dashboard } from "@/components/Dashboard";
import { RepoHealthCard } from "@/components/RepoHealthCard";
import { review, telemetry } from "./fixture";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

describe("RepoHealth", () => {
  it("shows suppression and heuristics from the API data", () => {
    render(<RepoHealthCard reviews={[review]} telemetry={telemetry} />);
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(
      screen.getByText("Heuristic based on finding severity"),
    ).toBeInTheDocument();
  });
  it("loads, searches, and renders a replay review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("telemetry")
            ? telemetry
            : { items: [review], total: 1, limit: 100, offset: 0 },
      })),
    );
    render(<Dashboard />);
    expect(screen.getByLabelText("Loading reviews")).toBeInTheDocument();
    await screen.findByText("Add passwordless session login");
    fireEvent.change(screen.getByRole("textbox", { name: "Search reviews" }), {
      target: { value: "not present" },
    });
    expect(screen.getByText("No matching reviews")).toBeInTheDocument();
  });
  it("shows service errors and allows retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Service unavailable"));
    vi.stubGlobal("fetch", fetch);
    render(<Dashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Service unavailable",
    );
    fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("telemetry")
          ? telemetry
          : { items: [], total: 0, limit: 100, offset: 0 },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.getByText("Your next review starts here"),
      ).toBeInTheDocument(),
    );
  });
});

it("loads the next review page on request", async () => {
  const next = {
    ...review,
    id: "next-review",
    result: {
      ...review.result,
      bundle: {
        ...review.result.bundle,
        context: {
          ...review.result.bundle.context,
          pr_title: "Second review page",
        },
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("telemetry")
          ? telemetry
          : {
              items: url.includes("offset=1") ? [next] : [review],
              total: 2,
              limit: 100,
              offset: 0,
            },
    })),
  );
  render(<Dashboard />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Second review page")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load more" }),
  ).not.toBeInTheDocument();
});

it("does not mislabel a publishable nit as important", async () => {
  const nitReview = structuredClone(review);
  nitReview.result.findings = [nitReview.result.findings[0]];
  nitReview.result.findings[0].verification.severity = "nit";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("telemetry")
          ? telemetry
          : { items: [nitReview], total: 1, limit: 100, offset: 0 },
    })),
  );
  render(<Dashboard />);
  expect(await screen.findByText("1 ready for review")).toBeInTheDocument();
  expect(screen.queryByText("1 important")).not.toBeInTheDocument();
});

it("normalizes non-text API error details", async () => {
  const { api } = await import("@/lib/api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      json: async () => ({ detail: [{ msg: "invalid input" }] }),
    })),
  );
  await expect(api.reviews()).rejects.toThrow(
    "The review service could not complete this request.",
  );
});

it("does not present incomplete reviews as clean or perfect health", async () => {
  const partial = structuredClone(review);
  partial.result.findings = [];
  partial.result.errors = [{ message: "Inference request timed out" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("telemetry")
          ? telemetry
          : { items: [partial], total: 1, limit: 100, offset: 0 },
    })),
  );
  render(<Dashboard />);
  expect(await screen.findByText("Partial review")).toBeInTheDocument();
  expect(screen.getByText("N/A")).toBeInTheDocument();
  expect(
    screen.queryByText("No high-confidence findings"),
  ).not.toBeInTheDocument();
});
