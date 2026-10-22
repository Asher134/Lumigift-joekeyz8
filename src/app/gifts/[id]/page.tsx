import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GiftCard } from "@/components/gift/GiftCard";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import type { Gift } from "@/types";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stellarKey?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const title = "A Time-Locked Gift Awaits";
  const description = "A private gift is waiting to be opened with Lumigift.";
  const image = `/gifts/${encodeURIComponent(id)}/opengraph-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: "A private Lumigift gift teaser" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

async function fetchGift(id: string): Promise<Gift | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/gifts/${id}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.success ? (json.data as Gift) : null;
}

export default async function GiftClaimPage({ params, searchParams }: Props) {
  const [{ id }, { stellarKey }] = await Promise.all([params, searchParams]);
  const gift = await fetchGift(id);
  if (!gift) notFound();

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "4rem auto",
        /* horizontal padding keeps content away from viewport edges on small screens */
        padding: "0 clamp(1rem, 4vw, 1.5rem)",
      }}
    >
      <OfflineBanner />
      <GiftCard gift={gift} perspective="recipient" recipientStellarKey={stellarKey} />
    </main>
  );
}
