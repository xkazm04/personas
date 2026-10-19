/**
 * ContentLoader -- loading state for a page or panel body.
 *
 * Renders the calm, static ghost lines the loading pattern requires
 * (`docs/design/overview-loading.md` law 3: no spinner, no pulse), centred in
 * the nearest flex parent rather than the viewport.
 *
 * It used to draw one of three PNG illustrations from
 * `/illustrations/loading/` with an opacity pulse. Those files were deleted in
 * 7d6e67ad04 ("Preprod polish") and nothing here noticed: every mount since
 * requested a missing image, and because the `<img>` had `alt=""` the browser
 * drew nothing, so the one live caller (the execution comparison diff) showed
 * an empty pulsing box while it loaded.
 *
 * Variants:
 *  - "page"  (default) -- fills the content area (Suspense fallbacks, page loads)
 *  - "panel" -- compact, for sections/tabs within a page
 */
import { DocumentGhost } from '@/features/shared/components/document/DocumentGhost';

interface ContentLoaderProps {
  /** "page" fills the flex parent, "panel" is compact. */
  variant?: 'page' | 'panel';
  /** Optional label shown beneath the ghost. */
  label?: string;
  /**
   * @deprecated No-op since the illustrations were removed; it only ever chose
   * which picture to draw. Accepted so existing call sites keep compiling.
   */
  hint?: string;
}

export default function ContentLoader({ variant = 'page', label }: ContentLoaderProps) {
  const isPage = variant === 'page';

  return (
    <div
      className={[
        'flex flex-col justify-center w-full',
        isPage ? 'flex-1 min-h-0 px-6' : 'py-3',
      ].join(' ')}
    >
      <DocumentGhost testId="content-loader-ghost" />
      {label && <p className="mt-3 typo-caption text-foreground">{label}</p>}
    </div>
  );
}
