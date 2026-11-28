import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const user = await getUser();
  if (!user)
    return Response.json({ detail: "Sign in required" }, { status: 401 });
  const { path } = await params;
  const route = path.join("/");
  const allowed =
    request.method === "GET" &&
    /^(reviews(?:\/[A-Za-z0-9_-]+)?|telemetry\/summary)$/.test(route);
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
      headers: {
        "X-TalkBridge-Key": process.env.DASHBOARD_API_KEY || "",
        "X-TalkBridge-User": user.id,
      },
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
export { proxy as GET };
