import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { createWishlist, createWishlistSchema } from "@/server/services/wishlist.service";
import type { Wishlist } from "@/server/services/wishlist.service";
import type { ApiResponse } from "@/types";

/** POST /api/v1/wishlists — recipient creates a public wish and gets a shareable link. */
export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const parsed = createWishlistSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const userId = (session.user as { id: string }).id;
    const wishlist = await createWishlist(userId, parsed.data);
    return NextResponse.json<ApiResponse<Wishlist>>(
      { success: true, data: wishlist },
      { status: 201 }
    );
  })
);
