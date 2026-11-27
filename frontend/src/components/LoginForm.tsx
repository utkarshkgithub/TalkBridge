"use client";
import { SiGithub, SiGoogle } from "react-icons/si";
import Link from "next/link";
import { useState } from "react";
import {
  LuEye as Eye,
  LuEyeOff as EyeOff,
  LuShieldCheck as ShieldCheck,
} from "react-icons/lu";
import { PixelMark } from "./PixelMark";
import { PixelBlocks } from "./PixelBlocks";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function LoginForm({
  providers,
  demo,
  showCredentials,
  error,
}: {
  providers: Record<string, boolean>;
  demo: boolean;
  showCredentials: boolean;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <header className="login-header">
        <Link href="/" className="saas-brand">
          <PixelMark />
          <span>TalkBridge</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="login-main">
        <div className="login-intro">
          <PixelBlocks className="login-pixel-fade" />
          <div className="login-intro-content">
            <PixelMark mascot />
            <span className="pixel-eyebrow">WELCOME TO YOUR WORKSPACE</span>
            <h1>
              Good code starts
              <br />
              with a second look.
            </h1>
            <p>
              Sign in to review pull requests, inspect findings, and connect
              your repositories.
            </p>
            <div className="login-security">
              <ShieldCheck size={16} /> Provider tokens stay on the server.
            </div>
          </div>
        </div>
        <section className="login-panel" aria-labelledby="login-heading">
          <div className="login-card">
            <h2 id="login-heading">Sign in to TalkBridge</h2>
            <p>Choose how you want to continue.</p>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="oauth-buttons">
              <form method="post" action="/api/auth/login/github">
                <Button
                  type="submit"
                  className="oauth-button"
                  variant="outline"
                  disabled={!providers.github}
                >
                  <SiGithub size={18} /> Continue with GitHub
                </Button>
              </form>
              <form method="post" action="/api/auth/login/google">
                <Button
                  type="submit"
                  className="oauth-button"
                  variant="outline"
                  disabled={!providers.google}
                >
                  <SiGoogle size={17} /> Continue with Google
                </Button>
              </form>
            </div>
            {(!providers.github || !providers.google) && (
              <p className="auth-config-note">
                OAuth sign-in needs workspace setup.
              </p>
            )}
            {demo && (
              <>
                <div className="auth-divider">
                  <span>or use a local test account</span>
                </div>
                <form
                  method="post"
                  action="/api/auth/demo"
                  onSubmit={() => setBusy(true)}
                  className="credentials-form"
                >
                  <label htmlFor="email">Email address</label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <label htmlFor="password">Password</label>
                  <div className="password-input">
                    <Input
                      id="password"
                      name="password"
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      maxLength={256}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={show ? "Hide password" : "Show password"}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <Button
                    type="submit"
                    className="login-submit"
                    disabled={busy}
                  >
                    {busy ? "Signing in..." : "Sign in with test account"}
                  </Button>
                </form>
                {showCredentials && (
                  <div className="test-credentials">
                    <div>
                      <strong>Local test account</strong>
                      <code>demo@talkbridge.local</code>
                      <code>TalkBridgeDemo!2026</code>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="Fill test credentials"
                      onClick={() => {
                        setEmail("demo@talkbridge.local");
                        setPassword("TalkBridgeDemo!2026");
                      }}
                    >
                      Fill
                    </Button>
                  </div>
                )}
              </>
            )}
            <p className="login-footnote">
              Repository access is authorized separately.
            </p>
          </div>
        </section>
      </main>
      <footer className="login-footer">
        <Link href="/">Back to homepage</Link>
        <span>Evidence first. Always.</span>
      </footer>
    </div>
  );
}
