import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { fulfilWishlist, fulfilWishlistSchema } from "@/server/services/wishlist.service";
import type { Wishlist } from "@/server/services/wishlist.service";
import type { ApiResponse } from "@/types";

/**
 * POST /api/v1/wishlists/:slug/fulfil — sender fulfils a wish from its link.
 * Creates the gift and returns the payment URL to complete funding.
 */
export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest, context: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const parsed = fulfilWishlistSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const { params } = context as { params: { slug: string } };
    const userId = (session.user as { id: string }).id;
    const result = await fulfilWishlist(params.slug, userId, parsed.data);
    if (!result) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Wishlist not found or already fulfilled" },
        { status: 409 }
      );
    }

    return NextResponse.json<
      ApiResponse<{ wishlist: Wishlist; giftId: string; paymentUrl: string }>
    >({ success: true, data: result });
  })
);
