import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/seo/AppIcon";

export const contentType = "image/png";

const SIZES = [192, 512];

export function generateImageMetadata() {
  return SIZES.map((s) => ({ id: String(s), size: { width: s, height: s }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  const s = Number(await id);
  return new ImageResponse(<AppIcon size={s} />, { width: s, height: s });
}
