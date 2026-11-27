import { SiGithub, SiGitlab, SiBitbucket } from "react-icons/si";
import Link from "next/link";
import {
  LuGitBranch as GitBranch,
  LuShieldCheck as ShieldCheck,
  LuSlidersHorizontal as SlidersHorizontal,
  LuCheck as Check,
} from "react-icons/lu";
import { PixelMark } from "./PixelMark";
import { PixelBlocks } from "./PixelBlocks";
import { ThemeToggle } from "./ThemeToggle";
import { MarketingHeader } from "./MarketingHeader";
import { EvidenceShowcase } from "./EvidenceShowcase";
import { ReviewCTA } from "./ReviewCTA";

export function Landing() {
  return (
    <div className="landing landing-boxed">
      <MarketingHeader />
      <main>
        <section className="hero hero-boxed">
          <div className="hero-rails" aria-hidden="true" />
          <div className="hero-copy">
            <span className="pixel-eyebrow">
              <span /> CODE REVIEW, WITH EVIDENCE
            </span>
            <h1>
              Find the bugs.
              <br />
              <span>Keep the signal.</span>
            </h1>
            <p>
              A focused workspace for verified pull request findings.
              <br className="hero-desktop-break" /> Less noise. Clearer
              evidence. Your code, your call.
            </p>
            <div className="hero-actions">
              <Link className="primary-link" href="/login">
                <PixelMark />
                Open your workspace
              </Link>
              <a className="secondary-link" href="#how-it-works">
                Explore the pipeline
              </a>
            </div>
            <div className="hero-note">
              <Check size={14} /> Try the local demo. No model server required.
            </div>
          </div>
          <div className="hero-blocks hero-blocks-left" aria-hidden="true">
            <PixelMark mascot />
            <PixelBlocks variant="left" />
          </div>
          <div className="hero-blocks hero-blocks-right" aria-hidden="true">
            <PixelMark mascot />
            <PixelBlocks variant="right" />
          </div>
        </section>
        <section className="integration-strip" id="integrations">
          <p>ONE WORKSPACE. YOUR REPOSITORIES.</p>
          <div>
            <span>
              <SiGithub /> GitHub
            </span>
            <span>
              <SiGitlab /> GitLab
            </span>
            <span>
              <SiBitbucket /> Bitbucket
            </span>
          </div>
          <small>
            Connect accounts and browse repositories. Automated PR reviews
            currently run through GitHub.
          </small>
        </section>
        <section className="marketing-features" id="how-it-works">
          <div className="marketing-section-heading">
            <span className="pixel-eyebrow">THE REVIEW PIPELINE</span>
            <h2>
              A second opinion.
              <br />
              With a paper trail.
            </h2>
            <p>Inspect each stage from source context to a verified finding.</p>
          </div>
          <div className="feature-grid">
            {[
              {
                icon: GitBranch,
                title: "Start with the right context",
                text: "Cleaned diffs and enclosing functions keep reviews focused on code that changed.",
              },
              {
                icon: ShieldCheck,
                title: "Challenge every finding",
                text: "Independent finders identify candidates. A skeptical verifier checks whether the evidence holds up.",
              },
              {
                icon: SlidersHorizontal,
                title: "Set your confidence threshold",
                text: "Inspect findings, compare confidence, and read the suggested patch before taking action.",
              },
            ].map(({ icon: Icon, title, text }, index) => (
              <article key={title}>
                <div className="feature-index">
                  <span>0{index + 1}</span>
                  <Icon size={22} />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <EvidenceShowcase />
        <ReviewCTA />
      </main>
      <footer className="marketing-footer marketing-footer-grid">
        <div className="footer-columns">
          <nav aria-label="Explore TalkBridge">
            <span className="pixel-eyebrow">EXPLORE</span>
            <a href="#how-it-works">How it works</a>
            <a href="#review-preview">Review examples</a>
            <a href="#integrations">Integrations</a>
          </nav>
          <nav aria-label="Workspace links">
            <span className="pixel-eyebrow">WORKSPACE</span>
            <Link href="/dashboard">Overview</Link>
            <Link href="/reviews">Pull request reviews</Link>
            <Link href="/insights">Insights</Link>
          </nav>
          <nav aria-label="Get started">
            <span className="pixel-eyebrow">GET STARTED</span>
            <Link href="/login">Sign in</Link>
            <Link href="/connections">Connect your repositories</Link>
            <Link href="/workflow">Explore the pipeline</Link>
          </nav>
        </div>
        <div className="footer-stage">
          <div className="footer-brand-note">
            <Link href="/" className="saas-brand">
              <PixelMark />
              <span>TalkBridge</span>
            </Link>
            <p>
              Evidence first.
              <br />
              You decide what ships.
            </p>
          </div>
          <div className="footer-large-mascot">
            <PixelMark mascot />
          </div>
          <div className="footer-preferences">
            <span className="pixel-eyebrow">APPEARANCE</span>
            <ThemeToggle />
          </div>
          <span className="footer-copyright">© TalkBridge</span>
        </div>
        <div className="footer-color-bands" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </footer>
    </div>
  );
}
