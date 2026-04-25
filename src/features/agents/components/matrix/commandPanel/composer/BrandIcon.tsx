/**
 * BrandIcon — paints a single-color brand SVG (Simple-Icons style, all
 * `fill="currentColor"`) in its real brand color via CSS mask, regardless
 * of theme. Loading the same SVG via `<img>` ignores currentColor and ends
 * up monochrome black, which is why we need the mask trick here.
 */
interface BrandIconProps {
  iconUrl: string;
  color: string;
  size: number;
  className?: string;
}
export function BrandIcon({ iconUrl, color, size, className = "" }: BrandIconProps) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        WebkitMask: `url("${iconUrl}") center / contain no-repeat`,
        mask: `url("${iconUrl}") center / contain no-repeat`,
        background: color,
      }}
    />
  );
}
