export function PixelBlocks({
  variant = "full",
  className = "",
}: {
  variant?: "left" | "right" | "full";
  className?: string;
}) {
  const heights =
    variant === "left"
      ? [5, 5, 3, 2, 1, 1]
      : variant === "right"
        ? [1, 1, 2, 3, 5, 5]
        : [3, 3, 2, 2, 1, 1, 2, 3, 4, 5, 5, 4];
  const colors = ["var(--primary)", "var(--block-mid)", "var(--block-light)"];
  return (
    <svg
      className={`pixel-blocks ${className}`}
      viewBox={`0 0 ${heights.length * 40} 200`}
      preserveAspectRatio="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {heights.flatMap((height, column) =>
        Array.from({ length: height }, (_, row) => (
          <rect
            key={`${column}-${row}`}
            x={column * 40}
            y={200 - (row + 1) * 40}
            width="40"
            height="40"
            fill={colors[(column + row * 2) % colors.length]}
          />
        )),
      )}
    </svg>
  );
}
