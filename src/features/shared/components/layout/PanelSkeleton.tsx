/**
 * Skeleton shimmer placeholder for lazy-loaded panels.
 * Mimics the ContentBox (header + body) layout so the transition
 * from skeleton to real content is seamless.
 *
 * Variants:
 *  - "panel"  (default) — full page skeleton with header bar + content blocks
 *  - "tab"    — smaller skeleton for editor tab content (no header bar)
 *  - "subtab" — minimal skeleton for sub-tab content (list/grid placeholder)
 *  - "section" — full-height centered spinner for top-level section loads
 */

interface PanelSkeletonProps {
  variant?: 'panel' | 'tab' | 'subtab' | 'section';
}

function ShimmerBlock({ className }: { className: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-white/[0.03] ${className}`}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export default function PanelSkeleton({ variant = 'panel' }: PanelSkeletonProps) {
  if (variant === 'section') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (variant === 'subtab') {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-150">
        {/* Toolbar shimmer */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10">
          <ShimmerBlock className="h-7 w-28 !rounded-lg" />
          <ShimmerBlock className="h-7 w-20 !rounded-lg" />
          <div className="flex-1" />
          <ShimmerBlock className="h-7 w-7 !rounded-lg" />
        </div>
        {/* List rows shimmer */}
        <div className="flex-1 p-4 space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <ShimmerBlock key={i} className={`h-12 ${i > 3 ? 'opacity-50' : ''}`} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'tab') {
    return (
      <div className="py-6 space-y-4 animate-in fade-in">
        <ShimmerBlock className="h-6 w-48" />
        <ShimmerBlock className="h-32" />
        <ShimmerBlock className="h-24" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header skeleton — matches ContentHeader height */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10">
        <ShimmerBlock className="h-10 w-10 !rounded-xl" />
        <div className="space-y-2">
          <ShimmerBlock className="h-4 w-36" />
          <ShimmerBlock className="h-3 w-24" />
        </div>
        <div className="flex-1" />
        <ShimmerBlock className="h-8 w-24 !rounded-lg" />
      </div>

      {/* Body skeleton — matches ContentBody padding */}
      <div className="flex-1 p-6 space-y-4">
        <ShimmerBlock className="h-48" />
        <div className="grid grid-cols-2 gap-4">
          <ShimmerBlock className="h-32" />
          <ShimmerBlock className="h-32" />
        </div>
      </div>
    </div>
  );
}
