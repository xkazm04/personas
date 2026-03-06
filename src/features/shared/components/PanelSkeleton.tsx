/**
 * Skeleton shimmer placeholder for lazy-loaded panels.
 * Mimics the ContentBox (header + body) layout so the transition
 * from skeleton to real content is seamless.
 *
 * Variants:
 *  - "panel"  (default) — full page skeleton with header bar + content blocks
 *  - "tab"    — smaller skeleton for editor tab content (no header bar)
 */

interface PanelSkeletonProps {
  variant?: 'panel' | 'tab';
}

function ShimmerBlock({ className }: { className: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-white/[0.03] ${className}`}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export default function PanelSkeleton({ variant = 'panel' }: PanelSkeletonProps) {
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
