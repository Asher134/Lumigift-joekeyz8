interface ShareImageProps {
  title: string;
  description: string;
}

export function ShareImage({ title, description }: ShareImageProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "72px 84px",
        background: "#f8f6ef",
        color: "#173b39",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>LUMIGIFT</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, marginTop: 48 }}>{title}</div>
        <div style={{ fontSize: 28, lineHeight: 1.35, marginTop: 24, color: "#49615c" }}>
          {description}
        </div>
      </div>
      <div
        style={{
          width: 220,
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ed795e",
          borderRadius: 28,
          color: "#fffaf0",
          fontSize: 112,
          fontWeight: 700,
        }}
      >
        L
      </div>
    </div>
  );
}
