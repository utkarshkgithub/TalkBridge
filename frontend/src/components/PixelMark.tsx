export function PixelMark({
  className = "",
  mascot = false,
}: {
  className?: string;
  mascot?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 56"
      fill="none"
      className={`pixel-mark ${className}`}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path
        fill="currentColor"
        d="M16 4h8v4h12v4h12v8h8v28H44V36h8V24H12v12h8v12H8V20h8V4Z"
      />
      <path fill="currentColor" d="M20 28h8v8h-8zm16 0h8v8h-8z" />
      {mascot && (
        <path
          fill="currentColor"
          opacity=".45"
          d="M4 52h20v4H4zm36 0h20v4H40z"
        />
      )}
    </svg>
  );
}
