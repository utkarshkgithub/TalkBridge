import { site } from "@/lib/site";

export function GET() {
  return new Response(
    `# TalkBridge

> Evidence-backed AI code reviews for pull requests.

TalkBridge presents review findings with confidence scores, attempted refutations, and suggested fixes. Developers decide what ships.

## Public product information

- [Landing page](${site.origin}/): Product overview and recorded examples.
- [Review pipeline](${site.origin}/#how-it-works): Context preparation, independent finders, adversarial verification, and confidence controls.
- [Repository connections](${site.origin}/#integrations): GitHub, GitLab, and Bitbucket account connections and repository browsing.
- [Illustrative reviews](${site.origin}/#review-preview): Recorded security, logic, and clean-review examples.

## Capabilities and limits

- Automated pull request reviews currently use a separately configured GitHub App.
- GitLab and Bitbucket support account authorization and repository browsing. Automated review ingestion is not available for those providers.
- Recorded replays are illustrative and do not publish comments to repositories.
- Sign-in, workspace pages, review details, and API responses require authentication and are not public product documentation.
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
