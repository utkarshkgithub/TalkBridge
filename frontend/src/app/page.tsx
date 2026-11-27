import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { site, siteStructuredData } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: site.title },
  alternates: { canonical: "/" },
  robots: {
    index: site.indexable,
    follow: true,
    googleBot: {
      index: site.indexable,
      follow: true,
      "max-image-preview": "large",
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    title: site.title,
    description: site.description,
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TalkBridge. Find the bugs. Keep the signal.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [
      {
        url: "/og-image.png",
        alt: "TalkBridge. Find the bugs. Keep the signal.",
      },
    ],
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Landing />
    </>
  );
}
