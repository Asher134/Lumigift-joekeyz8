import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/server/middleware";
import { getWishlist } from "@/server/services/wishlist.service";
import type { Wishlist } from "@/server/services/wishlist.service";
import type { ApiResponse } from "@/types";

/** GET /api/v1/wishlists/:slug — public wish details with fulfilled/unfulfilled status. */
export const GET = withErrorHandler(async (_req: NextRequest, context: unknown) => {
  const { params } = context as { params: { slug: string } };
  const wishlist = await getWishlist(params.slug);
  if (!wishlist) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Wishlist not found" },
      { status: 404 }
    );
  }
  return NextResponse.json<ApiResponse<Wishlist>>({ success: true, data: wishlist });
});
