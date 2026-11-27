"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { PixelMark } from "./PixelMark";
const links = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#integrations", label: "Integrations" },
  { href: "#review-preview", label: "Review examples" },
];
export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1001px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <header className="marketing-header marketing-header-cells">
      <Link href="/" className="saas-brand">
        <PixelMark />
        <span>TalkBridge</span>
      </Link>
      <nav className="marketing-primary-nav" aria-label="Site navigation">
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="marketing-header-actions">
        <Link className="marketing-login" href="/login">
          Sign in
        </Link>
        <Link className="header-start" href="/login">
          Get started
        </Link>
        <div className="marketing-mobile-menu">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              aria-label="Open site navigation"
              className="marketing-menu-trigger"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                shapeRendering="crispEdges"
                aria-hidden="true"
              >
                <path d="M3 5h18v2H3zM3 11h18v2H3zM3 17h18v2H3z" />
              </svg>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="marketing-menu-backdrop" />
              <Dialog.Popup
                className="marketing-menu-panel"
                aria-describedby={undefined}
              >
                <div className="marketing-menu-heading">
                  <Link
                    href="/"
                    className="marketing-menu-brand"
                    aria-label="TalkBridge home"
                    onClick={() => setOpen(false)}
                  >
                    <PixelMark />
                  </Link>
                  <Dialog.Title className="marketing-menu-title">
                    MENU
                  </Dialog.Title>
                  <Dialog.Close
                    className="marketing-menu-close"
                    aria-label="Close site navigation"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      shapeRendering="crispEdges"
                      aria-hidden="true"
                    >
                      <path d="M3 3h4v4h4v4h2V7h4V3h4v4h-4v4h-4v2h4v4h4v4h-4v-4h-4v-4h-2v4H7v4H3v-4h4v-4h4v-2H7V7H3V3Z" />
                    </svg>
                  </Dialog.Close>
                </div>
                <nav
                  className="marketing-menu-links"
                  aria-label="Mobile site navigation"
                >
                  {links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                      <PixelArrow />
                    </a>
                  ))}
                </nav>
                <div className="marketing-menu-bottom">
                  <p>Evidence first. You decide what ships.</p>
                  <Link
                    href="/login"
                    className="marketing-menu-signin"
                    onClick={() => setOpen(false)}
                  >
                    Sign in <PixelArrow />
                  </Link>
                  <Link
                    href="/login"
                    className="marketing-menu-start"
                    onClick={() => setOpen(false)}
                  >
                    Get started <PixelArrow />
                  </Link>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
function PixelArrow() {
  return (
    <svg
      viewBox="0 0 16 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d="M2 2h4v4h4v4h4v4h-4v4H6v4H2v-4h4v-4h4v-4H6V6H2V2Z" />
    </svg>
  );
}
