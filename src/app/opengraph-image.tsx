import { ImageResponse } from "next/og";
import { ShareImage } from "@/components/seo/ShareImage";

export const alt = "Lumigift time-locked cash gifts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <ShareImage
      title="Give a little joy, right on time."
      description="Send cash gifts that stay private until a surprise unlock date."
    />,
    size
  );
}
