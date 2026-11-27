import { Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { requireUser } from "@/lib/auth/session";
import { Pipeline } from "@/components/Pipeline";
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton kind="pipeline" />}>
      <Content />
    </Suspense>
  );
}
async function Content() {
  await requireUser();
  return <Pipeline />;
}
