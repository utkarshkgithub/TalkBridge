import type { NextRequest } from "next/server";

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const route = path.join("/");
  const allowed =
    request.method === "GET"
      ? /^(reviews(?:\/[A-Za-z0-9_-]+)?|telemetry\/summary)$/.test(route)
      : /^(demo\/replay|reviews\/run)\/(auth_sqli_pr|logic_edge_pr|clean_small_pr)$/.test(
          route,
        );
  if (!allowed)
    return Response.json({ detail: "Route not found" }, { status: 404 });
  const base = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(
    /\/$/,
    "",
  );
  const target = new URL(`${base}/api/${route}`);
  for (const key of ["limit", "offset"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  try {
    const response = await fetch(target, {
      method: request.method,
      cache: "no-store",
      signal: AbortSignal.timeout(180000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { detail: "The review service is offline. Reconnect and try again." },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
