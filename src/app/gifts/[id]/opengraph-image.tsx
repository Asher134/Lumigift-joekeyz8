import { ImageResponse } from "next/og";
import { ShareImage } from "@/components/seo/ShareImage";

export const alt = "A private Lumigift gift teaser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <ShareImage
      title="A gift is waiting."
      description="Open your private Lumigift when its surprise date arrives."
    />,
    size
  );
}
