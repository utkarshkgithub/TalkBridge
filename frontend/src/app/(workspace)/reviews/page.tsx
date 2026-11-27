import { Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Dashboard } from "@/components/Dashboard";
import { requireUser } from "@/lib/auth/session";
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
async function Content() {
  await requireUser();
  return <Dashboard section="reviews" />;
}
