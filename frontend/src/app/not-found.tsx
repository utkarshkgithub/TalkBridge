import Link from "next/link";
import { PixelMark } from "@/components/PixelMark";
export default function NotFound() {
  return (
    <main className="not-found">
      <Link href="/" className="saas-brand">
        <PixelMark />
        <span>TalkBridge</span>
      </Link>
      <div className="not-found-scene">
        <span className="pixel-404">404</span>
        <PixelMark mascot />
      </div>
      <span className="pixel-eyebrow">ROUTE NOT FOUND</span>
      <h1>This branch leads nowhere.</h1>
      <p>
        The page may have moved, or the link may be incorrect. Your workspace is
        one click away.
      </p>
      <div className="hero-actions">
        <Link className="primary-link" href="/dashboard">
          Open dashboard
        </Link>
        <Link className="secondary-link" href="/">
          Back to homepage
        </Link>
      </div>
    </main>
  );
}
