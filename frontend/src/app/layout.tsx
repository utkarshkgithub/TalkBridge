import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "TalkBridge | Code review workspace",
  description:
    "A focused workspace for verified code reviews, confidence controls, and pipeline insights.",
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
