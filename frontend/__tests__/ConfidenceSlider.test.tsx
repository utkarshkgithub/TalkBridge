import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PrDiffViewer } from "@/components/PrDiffViewer";
import { review } from "./fixture";

describe("ConfidenceSlider", () => {
  it("filters 92/65/35 locally without inference or fetch calls", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<PrDiffViewer review={review} />);
    expect(screen.getAllByTestId("finding-card")).toHaveLength(1);
    expect(screen.getByTestId("visible-count")).toHaveTextContent("1");
    // jsdom cannot lay out the thumb; browser accessibility is verified by E2E tests.
    const slider = screen.getByRole("slider", { hidden: true });
    for (let i = 0; i < 20; i++)
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(screen.getAllByTestId("finding-card")).toHaveLength(2);
    expect(screen.getByTestId("visible-count")).toHaveTextContent("2");
    for (let i = 0; i < 30; i++)
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(screen.getAllByTestId("finding-card")).toHaveLength(1);
    expect(
      screen.getByText(/Possible null username dereference/),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
