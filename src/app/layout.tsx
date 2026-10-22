import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "@/styles/globals.css";
import "@/styles/components.css";
import { Navbar } from "@/components/layout/Navbar";
import { TestnetBanner } from "@/components/ui/TestnetBanner";
import { ServiceWorkerRegister } from "@/components/ui/ServiceWorkerRegister";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://www.lumigift.com"),
  title: {
    default: "Lumigift — Time-Locked Cash Gifts on Stellar",
    template: "%s | Lumigift",
  },
  description:
    "Send cash gifts that stay hidden until a surprise unlock date. Powered by Stellar blockchain and USDC.",
  keywords: ["gifting", "stellar", "usdc", "blockchain", "nigeria", "surprise gift"],
  applicationName: "Lumigift",
  appleWebApp: { capable: true, title: "Lumigift", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "Lumigift — Time-Locked Cash Gifts",
    description: "Send cash gifts that unlock on a surprise date.",
    url: "https://www.lumigift.com",
    siteName: "Lumigift",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Lumigift time-locked cash gifts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lumigift — Time-Locked Cash Gifts",
    description: "Send cash gifts that unlock on a surprise date.",
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Propagate the per-request nonce to Next.js Script components so
            their inline bootstrapping scripts satisfy the strict CSP. */}
        <Script
          id="__nonce"
          nonce={nonce}
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: "" }}
        />
        {/* Prevent flash of wrong theme — runs before paint */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else if(window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>
          {/* Skip link: keyboard users can bypass the navbar and jump straight to main content */}
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <Navbar />
          <TestnetBanner />
          <ServiceWorkerRegister />
          <main id="main-content">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
