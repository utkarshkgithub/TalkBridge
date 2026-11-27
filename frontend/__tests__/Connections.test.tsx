import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Connections } from "@/components/Connections";

const initial = [{ provider: "github", account: "developer", expires: null }];
const providers = { github: true, gitlab: false, bitbucket: false };

describe("repository connections", () => {
  it("shows a skeleton until repositories arrive, then refreshes without stale rows", async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<Connections initial={initial} providers={providers} />);
    expect(
      screen.getByRole("status", { name: "Loading repositories" }),
    ).toBeInTheDocument();
    resolve({
      ok: true,
      json: async () => ({
        items: [{ id: "1", name: "developer/project", private: true }],
      }),
    });
    await screen.findByText("developer/project");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh repositories" }),
    );
    expect(screen.queryByText("developer/project")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading repositories" }),
    ).toBeInTheDocument();
    resolve({ ok: true, json: async () => ({ items: [] }) });
    await screen.findByText("No accessible repositories");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recovers from provider errors and disconnects stored credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Provider unavailable" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ connections: [] }),
      });
    vi.stubGlobal("fetch", fetch);
    render(<Connections initial={initial} providers={providers} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh repositories" }),
    );
    await screen.findByText("No accessible repositories");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/ }));
    await screen.findByText("No repositories connected");
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith("/api/auth/disconnect/github", {
        method: "POST",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Refresh repositories" }),
    ).toBeDisabled();
  });
});
