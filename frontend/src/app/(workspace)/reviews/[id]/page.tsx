import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { Dashboard } from "@/components/Dashboard";

export default function ReviewPage({ params }: PageProps<"/reviews/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="main-content" role="status">
          Loading review...
        </div>
      }
    >
      <ReviewContent params={params} />
    </Suspense>
  );
}
async function ReviewContent({
  params,
}: Pick<PageProps<"/reviews/[id]">, "params">) {
  await requireUser();
  const { id } = await params;
  return <Dashboard key={id} section="reviews" reviewId={id} />;
}
