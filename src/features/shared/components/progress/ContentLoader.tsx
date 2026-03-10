/**
 * ContentLoader — universal loading state for pages and panels.
 *
 * Uses one of three AI-themed illustrations with a CSS opacity pulse.
 * Centers within the nearest flex parent (content area), not the viewport,
 * so the sidebar never collides with the loader.
 *
 * Variants:
 *  - "page"  (default) — full content-area loader (Suspense fallbacks, page loads)
 *  - "panel" — smaller loader for sections/tabs within a page
 */

const ILLUSTRATIONS = [
  '/illustrations/loading/neural-nexus.png',
  '/illustrations/loading/quantum-core.png',
  '/illustrations/loading/signal-pulse.png',
] as const;

/** Pick a stable illustration per mount based on a simple hash of the label. */
function pickIllustration(hint?: string): (typeof ILLUSTRATIONS)[number] {
  if (!hint) return ILLUSTRATIONS[0];
  let hash = 0;
  for (let i = 0; i < hint.length; i++) hash = ((hash << 5) - hash + hint.charCodeAt(i)) | 0;
  return ILLUSTRATIONS[Math.abs(hash) % ILLUSTRATIONS.length]!;
}

interface ContentLoaderProps {
  /** "page" fills flex parent, "panel" is compact with py-8. */
  variant?: 'page' | 'panel';
  /** Optional label shown beneath the animation. */
  label?: string;
  /** Hint string used to deterministically pick an illustration. */
  hint?: string;
}

export default function ContentLoader({
  variant = 'page',
  label,
  hint,
}: ContentLoaderProps) {
  const src = pickIllustration(hint ?? label);
  const isPage = variant === 'page';

  return (
    <div
      className={[
        'flex flex-col items-center justify-center',
        isPage ? 'flex-1 min-h-0' : 'py-8',
      ].join(' ')}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className={[
          'select-none pointer-events-none animate-pulse-slow',
          isPage ? 'w-20 h-20' : 'w-14 h-14',
        ].join(' ')}
      />
      {label && (
        <p className="mt-3 text-xs text-muted-foreground/50 animate-pulse-slow">
          {label}
        </p>
      )}
    </div>
  );
}
