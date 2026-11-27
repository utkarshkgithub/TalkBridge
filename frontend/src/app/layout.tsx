import type { Metadata } from "next";
import { site } from "@/lib/site";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: { default: site.title, template: "%s | TalkBridge" },
  description: site.description,
  applicationName: site.name,
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="dark"
      data-appearance="dark"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('talkbridge-theme');t=t==='system'||t==='light'?t:'dark';document.documentElement.dataset.appearance=t;document.documentElement.classList.toggle('dark',t==='dark'||t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)}catch{}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
