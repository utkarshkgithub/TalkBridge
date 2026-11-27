const configuredUrl = process.env.SITE_URL || process.env.AUTH_URL;
const url = new URL(configuredUrl || "http://127.0.0.1:3000");
if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
  throw new Error("SITE_URL must be an HTTP(S) origin without credentials.");

export const site = {
  name: "TalkBridge",
  origin: url.origin,
  title: "TalkBridge | Evidence-backed AI code reviews",
  description:
    "Review pull requests with verified findings, confidence scores, and suggested fixes. Connect GitHub, GitLab, or Bitbucket and keep control of what ships.",
  indexable:
    process.env.NODE_ENV === "production" &&
    !!configuredUrl &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    process.env.SITE_NOINDEX !== "true",
};

export const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${site.origin}/#website`,
      url: `${site.origin}/`,
      name: site.name,
      description: site.description,
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${site.origin}/#application`,
      url: `${site.origin}/`,
      name: site.name,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: site.description,
      featureList: [
        "Pull request review findings with confidence scores",
        "Adversarial verification and suggested fixes",
        "GitHub, GitLab, and Bitbucket repository connections",
        "Recorded review replays and pipeline telemetry",
      ],
    },
  ],
};
