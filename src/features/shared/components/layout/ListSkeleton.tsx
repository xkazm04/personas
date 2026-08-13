/**
 * @catalog ListSkeleton — calm, non-pulsing placeholder rows for a list/table body while the first page loads, so panel chrome lands before data (no big-bang spinner, no shimmer).
 *
 * Pairs with frame-first loading: render `ContentHeader` (or
 * `ContentHeaderSkeleton`) immediately and drop this into the `ContentBody`
 * while the L1 page is in flight, then swap in the real rows as they reveal.
 *
 * Placeholder bars are always the calm `bg-primary/[0.06]` treatment required by
 * the golden loading pattern (`docs/design/overview-loading.md` law 3): static,
 * lower-contrast, NO pulse — a pulsing placeholder blinks through the
 * ghost→content swap and can't be hidden behind an entrance delay. Per pattern
 * v2 this belongs ONLY inside delay-hidden Suspense fallbacks (§D) — never as a
 * data-fetch gate around primary content (build a module-local delayed ghost
 * instead).
 */
interface ListSkeletonProps {
  /** Number of placeholder rows. Default 8. */
  rows?: number;
  /** Row height in px — match the real row so there's no layout shift. Default 48. */
  rowHeight?: number;
  /** Show a leading avatar/icon block on each row. Default true. */
  leading?: boolean;
  /**
   * @deprecated No-op — calm is now the only treatment. Accepted so the existing
   * call sites keep compiling; drop it when you next touch them.
   */
  calm?: boolean;
  className?: string;
}

export function ListSkeleton({
  rows = 8,
  rowHeight = 48,
  leading = true,
  className,
}: ListSkeletonProps) {
  const bar = 'bg-primary/[0.06]';
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
