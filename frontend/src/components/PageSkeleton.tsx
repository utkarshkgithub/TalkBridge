import { Skeleton } from "./ui/skeleton";
export function PageSkeleton({
  kind = "dashboard",
}: {
  kind?: "dashboard" | "connections" | "pipeline";
}) {
  return (
    <main
      className="main-content page-skeleton"
      role="status"
      aria-label={`Loading ${kind}`}
    >
      <span className="sr-only">Loading {kind}...</span>
      <div className="page-heading">
        <div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-3 h-4 w-64 max-w-full" />
        </div>
      </div>
      {kind === "connections" ? (
        <>
          <div className="provider-grid">
            {[0, 1, 2].map((n) => (
              <div className="surface skeleton-provider" key={n}>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="mt-6 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-6 h-8 w-32" />
              </div>
            ))}
          </div>
          <div className="surface skeleton-repositories">
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2].map((n) => (
              <Skeleton className="mt-5 h-10 w-full" key={n} />
            ))}
          </div>
        </>
      ) : kind === "pipeline" ? (
        <>
          <Skeleton className="mb-6 h-8 w-72 max-w-full" />
          <div className="workflow-canvas">
            <div className="workflow-stages">
              {[0, 1, 2, 3, 4].map((n) => (
                <div className="surface skeleton-stage" key={n}>
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-5 h-5 w-full" />
                  <Skeleton className="mt-3 h-16 w-full" />
                  <Skeleton className="mt-6 h-4 w-3/4" />
                </div>
              ))}
            </div>
          </div>
          <div className="pipeline-explainer mt-6">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </>
      ) : (
        <>
          <div className="metrics-grid">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton className="h-28" key={n} />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </>
      )}
    </main>
  );
}
