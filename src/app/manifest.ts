import type { MetadataRoute } from "next";

/** Web App Manifest — makes Lumigift installable as a PWA (issue #349). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumigift — Time-Locked Cash Gifts",
    short_name: "Lumigift",
    description: "Send cash gifts that unlock on a surprise date.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0f1a",
    theme_color: "#6366f1",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
