import { randomBytes } from "crypto";
import { z } from "zod";
import pool from "@/lib/db";
import { serverConfig } from "@/server/config";
import { createGiftSchema } from "@/types/schemas";
import { createGift } from "./gift.service";

export const createWishlistSchema = z.strictObject({
  title: z.string().trim().min(2).max(120),
  recipientName: createGiftSchema.shape.recipientName,
  recipientPhone: createGiftSchema.shape.recipientPhone,
  targetAmountNgn: createGiftSchema.shape.amountNgn,
  unlockAt: createGiftSchema.shape.unlockAt,
});

export const fulfilWishlistSchema = z.strictObject({
  paymentProvider: createGiftSchema.shape.paymentProvider,
  message: createGiftSchema.shape.message,
});

export type CreateWishlistInput = z.infer<typeof createWishlistSchema>;
export type FulfilWishlistInput = z.infer<typeof fulfilWishlistSchema>;

/** Public view of a wish — the recipient's phone number is never exposed. */
export interface Wishlist {
  slug: string;
  title: string;
  recipientName: string;
  targetAmountNgn: number;
  unlockAt: string;
  status: "open" | "fulfilled";
  fulfilledAt: string | null;
  shareUrl: string;
}

interface WishlistRow {
  slug: string;
  owner_id: string;
  title: string;
  recipient_name: string;
  recipient_phone: string;
  target_amount_ngn: number;
  unlock_at: Date;
  status: "open" | "fulfilled";
  fulfilled_at: Date | null;
}

export function wishlistShareUrl(slug: string): string {
  return `${serverConfig.app.url}/wishlist/${slug}`;
}

function toWishlist(row: WishlistRow): Wishlist {
  return {
    slug: row.slug,
    title: row.title,
    recipientName: row.recipient_name,
    targetAmountNgn: row.target_amount_ngn,
    unlockAt: new Date(row.unlock_at).toISOString(),
    status: row.status,
    fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at).toISOString() : null,
    shareUrl: wishlistShareUrl(row.slug),
  };
}

/**
 * Creates a public wish with a target amount and unlock date.
 *
 * @returns The wish, including its shareable link.
 */
export async function createWishlist(
  ownerId: string,
  input: CreateWishlistInput
): Promise<Wishlist> {
  const slug = randomBytes(9).toString("base64url");
  const { rows } = await pool.query<WishlistRow>(
    "INSERT INTO wishlists (slug, owner_id, title, recipient_name, recipient_phone, target_amount_ngn, unlock_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [
      slug,
      ownerId,
      input.title,
      input.recipientName,
      input.recipientPhone,
      input.targetAmountNgn,
      input.unlockAt,
    ]
  );
  return toWishlist(rows[0]);
}

/** Returns the public view of a wish, or `null` if it does not exist. */
export async function getWishlist(slug: string): Promise<Wishlist | null> {
  const { rows } = await pool.query<WishlistRow>("SELECT * FROM wishlists WHERE slug = $1", [slug]);
  return rows[0] ? toWishlist(rows[0]) : null;
}

/**
 * Fulfils an open wish: creates the gift for the recipient, marks the wish
 * fulfilled and notifies the recipient.
 *
 * @returns The payment URL for the created gift, or `null` if the wish does not
 *   exist or is already fulfilled.
 */
export async function fulfilWishlist(
  slug: string,
  senderId: string,
  input: FulfilWishlistInput
): Promise<{ wishlist: Wishlist; giftId: string; paymentUrl: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<WishlistRow>(
      "SELECT * FROM wishlists WHERE slug = $1 AND status = 'open' FOR UPDATE",
      [slug]
    );
    const wish = rows[0];
    if (!wish) {
      await client.query("ROLLBACK");
      return null;
    }

    const { gift, paymentUrl } = await createGift(senderId, {
      recipientPhone: wish.recipient_phone,
      recipientName: wish.recipient_name,
      amountNgn: wish.target_amount_ngn,
      unlockAt: new Date(wish.unlock_at).toISOString(),
      message: input.message,
      paymentProvider: input.paymentProvider,
      recipientIsRegistered: true,
    });

    const { rows: updated } = await client.query<WishlistRow>(
      "UPDATE wishlists SET status = 'fulfilled', gift_id = $2, fulfilled_by = $3, fulfilled_at = NOW() WHERE slug = $1 RETURNING *",
      [slug, gift.id, senderId]
    );

    await client.query(
      "INSERT INTO notifications (user_id, type, message, metadata) VALUES ($1, 'wish_fulfilled', $2, $3)",
      [
        wish.owner_id,
        `Your wish "${wish.title}" was fulfilled! 🎁`,
        JSON.stringify({ slug, giftId: gift.id }),
      ]
    );

    await client.query("COMMIT");
    return { wishlist: toWishlist(updated[0]), giftId: gift.id, paymentUrl };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
