import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { demoEnabled, getUser } from "@/lib/auth/session";
import { availableProviders } from "@/lib/auth/oauth";
export default function Page(props: PageProps<"/login">) {
  return (
    <Suspense
      fallback={<div className="route-loading">Loading sign-in...</div>}
    >
      <Content {...props} />
    </Suspense>
  );
}
async function Content({ searchParams }: PageProps<"/login">) {
  if (await getUser()) redirect("/dashboard");
  const query = await searchParams;
  return (
    <LoginForm
      providers={availableProviders()}
      demo={demoEnabled()}
      showCredentials={
        demoEnabled() &&
        !process.env.DEMO_AUTH_PASSWORD &&
        !process.env.DEMO_AUTH_EMAIL
      }
      error={
        typeof query.error === "string" ? query.error.slice(0, 300) : undefined
      }
    />
  );
}
