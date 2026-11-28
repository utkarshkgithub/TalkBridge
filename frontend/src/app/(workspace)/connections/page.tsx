import { Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { requireUser } from "@/lib/auth/session";
import {
  availableProviders,
  connections,
  listInstallations,
} from "@/lib/auth/oauth";
import { Connections } from "@/components/Connections";
export default function Page(props: PageProps<"/connections">) {
  return (
    <Suspense fallback={<PageSkeleton kind="connections" />}>
      <Content {...props} />
    </Suspense>
  );
}
async function Content({ searchParams }: PageProps<"/connections">) {
  const user = await requireUser();
  const query = await searchParams;
  const message =
    typeof query.error === "string"
      ? query.error.slice(0, 300)
      : query.installed === "1"
        ? "GitHub App installation verified and linked."
        : typeof query.connected === "string" &&
            ["github", "gitlab", "bitbucket"].includes(query.connected)
          ? `${query.connected} connected successfully.`
          : undefined;
  return (
    <Connections
      initial={await connections(user.id)}
      initialInstallations={await listInstallations(user.id)}
      appSlug={process.env.GITHUB_APP_SLUG || ""}
      providers={availableProviders()}
      message={message}
    />
  );
}
