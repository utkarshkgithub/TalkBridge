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
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
