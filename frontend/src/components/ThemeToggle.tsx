"use client";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
type Appearance = "system" | "light" | "dark";
function valid(value: string | null | undefined): Appearance {
  return value === "system" || value === "light" ? value : "dark";
}
function apply(value: Appearance) {
  document.documentElement.dataset.appearance = value;
  document.documentElement.classList.toggle(
    "dark",
    value === "dark" ||
      (value === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),
  );
}
function getAppearance() {
  return valid(document.documentElement.dataset.appearance);
}
function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemChanged = () => {
    if (getAppearance() === "system") apply("system");
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === "talkbridge-theme") {
      apply(valid(event.newValue));
      onChange();
    }
  };
  window.addEventListener("talkbridge:theme", onChange);
  window.addEventListener("storage", storageChanged);
  media.addEventListener("change", systemChanged);
  return () => {
    window.removeEventListener("talkbridge:theme", onChange);
    window.removeEventListener("storage", storageChanged);
    media.removeEventListener("change", systemChanged);
  };
}
export function ThemeToggle() {
  const appearance = useSyncExternalStore(
    subscribe,
    getAppearance,
    () => "dark",
  );
  function select(value: Appearance) {
    apply(value);
    try {
      localStorage.setItem("talkbridge-theme", value);
    } catch {
      /* The current selection still works without browser storage. */
    }
    window.dispatchEvent(new Event("talkbridge:theme"));
  }
  return (
    <div className="theme-control" role="group" aria-label="Appearance">
      {[
        { value: "system", label: "Use system theme", icon: PixelMonitor },
        { value: "light", label: "Switch to light mode", icon: PixelSun },
        { value: "dark", label: "Switch to dark mode", icon: PixelMoon },
      ].map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          className="appearance-option"
          title={label}
          aria-label={label}
          aria-pressed={appearance === value}
          onClick={() => select(value as Appearance)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}

function PixelMonitor() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2 3h20v14H2V3Zm3 3v8h14V6H5Z"
      />
      <path fill="currentColor" d="M10 17h4v3h4v2H6v-2h4v-3Z" />
    </svg>
  );
}
function PixelSun() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9 7h6v2h2v6h-2v2H9v-2H7V9h2V7Zm1 3v4h4v-4h-4Z"
      />
      <path
        fill="currentColor"
        d="M10 1h4v3h-4zM10 20h4v3h-4zM1 10h3v4H1zM20 10h3v4h-3zM3 3h3v3H3zM18 3h3v3h-3zM3 18h3v3H3zM18 18h3v3h-3z"
      />
    </svg>
  );
}
function PixelMoon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
      <path
        fill="currentColor"
        d="M10 2h4v2h-4v6h2v2h2v2h6v-4h2v6h-2v4h-4v2H8v-2H4v-4H2V8h2V4h6V2Zm-4 4v2H4v6h2v4h2v2h6v-2h4v-2h-6v-2h-2v-2H8V6H6Z"
        fillRule="evenodd"
      />
    </svg>
  );
}
