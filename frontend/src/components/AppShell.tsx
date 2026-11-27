"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment, useRouter } from "next/navigation";
import {
  LuActivity as Activity,
  LuBookOpen as BookOpen,
  LuChevronDown as ChevronDown,
  LuGitPullRequest as GitPullRequest,
  LuLayoutDashboard as LayoutDashboard,
  LuLink2 as Link2,
  LuLogOut as LogOut,
  LuMenu as Menu,
  LuWorkflow as Workflow,
  LuX as X,
} from "react-icons/lu";
import { ThemeToggle } from "./ThemeToggle";
import { PixelMark } from "./PixelMark";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/reviews", label: "All reviews", icon: GitPullRequest },
  { href: "/insights", label: "Insights", icon: Activity },
  { href: "/workflow", label: "Pipeline", icon: Workflow },
  { href: "/connections", label: "Connections", icon: Link2 },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={<WorkspaceShell segment={null}>{children}</WorkspaceShell>}
    >
      <RoutedWorkspaceShell>{children}</RoutedWorkspaceShell>
    </Suspense>
  );
}
function RoutedWorkspaceShell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <WorkspaceShell segment={segment}>{children}</WorkspaceShell>;
}
function WorkspaceShell({
  children,
  segment,
}: {
  children: React.ReactNode;
  segment: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{
    name: string;
    email: string;
    provider: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setUser(data.user || null))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById("dashboard-navigation");
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        document
          .querySelector<HTMLButtonElement>(
            '[aria-controls="dashboard-navigation"]',
          )
          ?.focus();
      }
      if (event.key === "Tab") {
        const nodes = focusable();
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const active = navigation.find(
    (n) => n.href === `/${segment || "dashboard"}`,
  );
  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <div className="saas-shell">
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="dashboard-navigation"
        aria-label="Workspace navigation"
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        className={`dashboard-sidebar ${open ? "is-open" : ""}`}
      >
        <Link href="/dashboard" className="saas-brand">
          <PixelMark />
          <span>TalkBridge</span>
          <span className="pixel-beta">BETA</span>
        </Link>
        <div className="workspace-picker">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="workspace-trigger"
              aria-label="Workspace menu"
            >
              <LayoutDashboard size={15} />
              <span className="workspace-trigger-copy">
                <strong>Development workspace</strong>
              </span>
              <ChevronDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="workspace-menu">
              <div className="account-menu-label">
                Development workspace<strong>Workspace navigation</strong>
              </div>
              <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                <LayoutDashboard size={14} /> Workspace overview
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/connections")}>
                <Link2 size={14} /> Manage connections
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/workflow")}>
                <Workflow size={14} /> Review pipeline
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active?.href === href ? "page" : undefined}
              className={`sidebar-link ${active?.href === href ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-help">
          <PixelMark mascot />
          <strong>Your code. Your call.</strong>
          <p>
            Every finding includes the evidence, confidence, and a suggested
            fix.
          </p>
          <Link href="/workflow" onClick={() => setOpen(false)}>
            <BookOpen size={14} /> How reviews work
          </Link>
        </div>
        <div className="sidebar-account">
          <div className="account-avatar">
            {user?.name?.slice(0, 2).toUpperCase() || "TB"}
          </div>
          <div>
            <strong>{user?.name || "Developer"}</strong>
            <span>
              {user?.provider === "demo"
                ? "Test account"
                : "Development workspace"}
            </span>
          </div>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-topbar">
          <div className="shell-breadcrumb">
            <Button
              size="icon"
              variant="ghost"
              className="sidebar-toggle"
              aria-controls="dashboard-navigation"
              aria-expanded={open}
              aria-label={open ? "Close navigation" : "Open navigation"}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </Button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{active?.label || "Dashboard"}</strong>
          </div>
          <div className="shell-actions">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="account-trigger"
                aria-label="Account menu"
              >
                <span className="account-avatar small">
                  {user?.name?.slice(0, 2).toUpperCase() || "TB"}
                </span>
                <ChevronDown size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <div className="account-menu-label">
                  Signed in as
                  <strong>{user?.email || user?.name || "Developer"}</strong>
                </div>
                <DropdownMenuItem onClick={() => router.push("/connections")}>
                  <Link2 size={14} /> Manage connections
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const form = document.getElementById(
                      "signout-form",
                    ) as HTMLFormElement;
                    form.requestSubmit();
                  }}
                >
                  <LogOut size={14} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <form
              id="signout-form"
              method="post"
              action="/api/auth/logout"
              hidden
            />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
