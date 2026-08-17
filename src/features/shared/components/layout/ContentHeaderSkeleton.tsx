import { IS_MOBILE } from '@/lib/utils/platform/platform';

/**
 * Skeleton twin of `ContentHeader` (see `ContentLayout.tsx`).
 *
 * Renders the exact page-header chrome — identical padding, border, brand
 * tint, sticky positioning, and the icon / title / subtitle / actions slot
 * geometry — with calm, static placeholder bars in place of text (never
 * pulsing: `docs/design/overview-loading.md` law 3).
 *
 * Use it as (part of) a Suspense fallback so the header paints in the very
 * first frame while the lazy route chunk and its data are still in flight.
 * Because the placeholder bars are sized in `em` units inside the *real*
 * `typo-*` line boxes, the header keeps its true height and the swap to the
 * loaded `ContentHeader` produces no layout shift.
 *
 * Keep the prop flags aligned with the `ContentHeader` the route actually
 * renders (icon? actions? subtitle?). The class lists below are intentionally
 * copied from `ContentHeader` rather than shared — **if you restyle
 * `ContentHeader`, update this twin in the same change.**
 */
interface ContentHeaderSkeletonProps {
  /** Render the leading icon-chip placeholder. Match the real header. */
  showIcon?: boolean;
  /** Render the trailing actions placeholder (e.g. a select control). */
  showActions?: boolean;
  /** Render the large subtitle bar. Most headers carry a subtitle. */
  showSubtitle?: boolean;
  /**
   * @deprecated No-op — calm is now the only treatment. Accepted so the existing
   * call sites keep compiling; drop it when you next touch them.
   */
  calm?: boolean;
}

export function ContentHeaderSkeleton({
  showIcon = false,
  showActions = false,
  showSubtitle = true,
}: ContentHeaderSkeletonProps) {
  const bar = 'bg-primary/[0.06]';
  const barStrong = 'bg-primary/[0.06]';
  return (
    <div
      aria-hidden="true"
      className={[
        IS_MOBILE ? 'px-3 py-2.5' : 'px-4 md:px-6 xl:px-8 py-4',
        // Mirror of ContentHeader: brand-tinted "operator console" band.
        'border-b border-primary/10 bg-primary/5 flex-shrink-0 min-w-[80vw]',
        // No `backdrop-blur` — mirrors ContentHeader; see the note there
        // about the WebView2 backdrop-filter flicker.
        'sticky top-0 z-10 shadow-none',
      ].join(' ')}
    >
      <div className="flex items-center gap-3 pr-20">
        {showIcon && (
          <div
            className={`${IS_MOBILE ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg flex-shrink-0 ${bar}`}
          />
        )}
        <div className="flex-1 min-w-0">
          {/* Title placeholder — sits inside the real typo-caption line box. */}
          <div className="typo-caption">
            <span className={`inline-block h-[0.7em] w-24 rounded align-middle ${bar}`} />
          </div>
          {/* Subtitle placeholder — inside the dominant typo-heading-lg box. */}
          {showSubtitle && (
            <div className="typo-heading-lg mt-0.5">
              <span className={`inline-block h-[0.6em] w-52 rounded align-middle ${barStrong}`} />
            </div>
          )}
        </div>
        {showActions && (
          <div className={`h-9 w-40 rounded-input flex-shrink-0 ${bar}`} />
        )}
      </div>
    </div>
  );
}
