/**
 * @catalog ListSkeleton — shimmer placeholder rows for a list/table body while the first page loads, so panel chrome lands before data (no big-bang spinner).
 *
 * Pairs with frame-first loading: render `ContentHeader` (or
 * `ContentHeaderSkeleton`) immediately and drop this into the `ContentBody`
 * while the L1 page is in flight, then swap in the real rows as they reveal.
 *
 * Placeholder bars use the same `bg-primary/10 animate-pulse` treatment as
 * `ContentHeaderSkeleton` so the two read as one loading surface. Pass `calm`
 * for the golden loading pattern (`docs/design/overview-loading.md`): a static,
 * lower-contrast placeholder with NO pulse, so it can cross-fade to content
 * (via `LoadingReveal`) without the pulse animation drawing the eye / blinking.
 */
interface ListSkeletonProps {
  /** Number of placeholder rows. Default 8. */
  rows?: number;
  /** Row height in px — match the real row so there's no layout shift. Default 48. */
  rowHeight?: number;
  /** Show a leading avatar/icon block on each row. Default true. */
  leading?: boolean;
  /** Static, non-pulsing, lower-contrast bars — the golden-pattern default. */
  calm?: boolean;
  className?: string;
}

export function ListSkeleton({
  rows = 8,
  rowHeight = 48,
  leading = true,
  calm = false,
  className,
}: ListSkeletonProps) {
  const bar = calm ? 'bg-primary/[0.06]' : 'bg-primary/10 animate-pulse';
  return (
    <div className={`flex flex-col ${className ?? ''}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 border-b border-primary/[0.06]"
          style={{ height: rowHeight }}
        >
          {leading && (
            <span className={`w-8 h-8 rounded-card flex-shrink-0 ${bar}`} />
          )}
          <span className={`h-3.5 flex-1 rounded ${bar}`} />
          <span className={`h-3.5 w-16 flex-shrink-0 rounded ${bar}`} />
          <span className={`h-3.5 w-12 flex-shrink-0 rounded ${bar}`} />
        </div>
      ))}
    </div>
  );
}
