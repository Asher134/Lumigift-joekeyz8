/** Square Lumigift app icon rendered by `next/og` for the PWA manifest. */
export function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #6366f1, #ec4899)",
        color: "#fff",
        fontSize: size * 0.6,
        fontWeight: 800,
      }}
    >
      L
    </div>
  );
}
