import { ImageResponse } from "next/og";
import { ShareImage } from "@/components/seo/ShareImage";

export const alt = "Create a time-locked gift with Lumigift";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <ShareImage
      title="Make their day."
      description="Choose a recipient, a gift, and the perfect date to unlock it."
    />,
    size
  );
}
