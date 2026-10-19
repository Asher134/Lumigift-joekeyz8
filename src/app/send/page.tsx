import type { Metadata } from "next";
import { GiftWizard } from "@/components/gift/GiftWizard";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Send a Gift",
  description: "Create a thoughtful cash gift that unlocks on a date you choose.",
  openGraph: {
    title: "Send a Gift with Lumigift",
    description: "Create a thoughtful cash gift that unlocks on a date you choose.",
    images: [
      {
        url: "/send/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Create a time-locked gift with Lumigift",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Send a Gift with Lumigift",
    description: "Create a thoughtful cash gift that unlocks on a date you choose.",
    images: ["/send/opengraph-image"],
  },
};

export default function SendPage() {
  return (
    <div className={styles.page}>
      <div className={`container container--sm ${styles.inner}`}>
        <GiftWizard />
      </div>
    </div>
  );
}
