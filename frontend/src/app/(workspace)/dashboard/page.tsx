import { Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Dashboard } from "@/components/Dashboard";
import { availableProviders, connections, listInstallations } from "@/lib/auth/oauth";
import { requireUser } from "@/lib/auth/session";
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
async function Content() {
  const user = await requireUser();
  const [userConnections, installations] = await Promise.all([
    connections(user.id),
    listInstallations(user.id),
  ]);
  return (
    <Dashboard
      addProject={{
        githubConnected: userConnections.some((c) => c.provider === "github"),
        githubEnabled: availableProviders().github,
        appSlug: process.env.GITHUB_APP_SLUG || "triagelenspr",
        installations,
      }}
    />
  );
}
