import { IconBase, type IconBaseProps } from "react-icons";

const paths = {
  menu: "M4 2h16v2h2v2H2V4h2V2ZM2 10h20v4H2v-4Zm0 8h20v2h-2v2H4v-2H2v-2Z",
  close:
    "M2 2h4v4h4v4h4V6h4V2h4v4h-4v4h-4v4h4v4h4v4h-4v-4h-4v-4h-4v4H6v4H2v-4h4v-4h4v-4H6V6H2V2Z",
  chevronRight: "M6 2h4v4h4v4h4v4h-4v4h-4v4H6v-4h4v-4h4v-4h-4V6H6V2Z",
  arrowUpRight: "M6 2h16v16h-4V8h-4v4h-4v4H6v4H2v-4h4v-4h4V8h4V6H6V2Z",
  check: "M18 4h4v4h-4v4h-4v4h-4v4H6v-4H2v-4h4v4h4v-4h4V8h4V4Z",
  shield:
    "M10 2h4v2h6v10h-2v4h-2v2h-2v2h-4v-2H8v-2H6v-4H4V4h6V2Zm0 4H6v8h2v4h2v2h4v-2h2v-4h2V6h-4V4h-4v2Zm4 3h2v4h-2v2h-4v-2H8v-2h2v2h2v-2h2V9Z",
  branch:
    "M4 2h6v6H8v8h8v-4h-2V6h6v6h-2v6H8v4H4v-4H2v-6h2V8H2V2h2Zm0 2v2h4V4H4Zm12 4v2h2V8h-2ZM4 14v2h2v-2H4Z",
  sliders:
    "M2 4h8V2h4v2h8v2h-8v2h-4V6H2V4Zm0 7h4V9h4v2h12v2H10v2H6v-2H2v-2Zm0 7h12v-2h4v2h4v2h-4v2h-4v-2H2v-2Z",
  braces:
    "M6 2h4v2H6v6H4v4h2v6h4v2H6v-2H4v-6H2v-4h2V4h2V2Zm8 0h4v2h2v6h2v4h-2v6h-2v2h-4v-2h4v-6h2v-4h-2V4h-4V2Z",
  clean:
    "M8 2h8v2h4v4h2v8h-2v4h-4v2H8v-2H4v-4H2V8h2V4h4V2Zm0 4H6v2H4v8h2v2h2v2h8v-2h2v-2h2V8h-2V6h-2V4H8v2Zm8 2h2v4h-2v2h-2v2h-4v-2H8v-2h2v2h2v-2h2v-2h2V8Z",
  file: "M4 2h12v2h2v2h2v16H4V2Zm2 2v16h12V8h-4V4H6Zm10 2v2h2V6h-2ZM8 10h6v2H8v-2Zm0 4h8v2H8v-2Zm0 4h6v2H8v-2Z",
} as const;

export type PixelIconName = keyof typeof paths;

export function PixelIcon({
  name,
  ...props
}: IconBaseProps & { name: PixelIconName }) {
  return (
    <IconBase
      {...props}
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
      data-pixel-icon={name}
    >
      <path fill="currentColor" fillRule="evenodd" d={paths[name]} />
    </IconBase>
  );
}
