import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWishlist } from "@/server/services/wishlist.service";
import { FulfilWishButton } from "@/components/gift/FulfilWishButton";
import { formatNGN } from "@/lib/currency";

interface Props {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  title: "A Lumigift Wish",
  description: "Someone shared a gift wish with you on Lumigift.",
};

export default async function WishlistPage({ params }: Props) {
  const { slug } = await params;
  const wish = await getWishlist(slug);
  if (!wish) notFound();

  const fulfilled = wish.status === "fulfilled";

  return (
    <main className="container">
      <h1>{wish.title}</h1>
      <p>
        {wish.recipientName} is wishing for <strong>{formatNGN(wish.targetAmountNgn)}</strong>,
        unlocking on {new Date(wish.unlockAt).toDateString()}.
      </p>
      <p>
        Status: <strong>{fulfilled ? "Fulfilled ✓" : "Unfulfilled"}</strong>
      </p>
      {!fulfilled && <FulfilWishButton slug={wish.slug} />}
    </main>
  );
}
