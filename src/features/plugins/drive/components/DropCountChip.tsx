/**
 * Small badge shown on the currently-hovered drop target during a drive-
 * internal drag, indicating how many files are about to land there.
 * Used on sidebar tree nodes, file-list folder rows, and breadcrumb
 * pills so the user feels the payload's weight before they drop —
 * a 1-file move feels different from a 12-file move.
 */
export function DropCountChip({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-cyan-400/30 border border-cyan-300/60 text-cyan-50 typo-caption font-bold tabular-nums shadow-[0_0_8px_-2px_rgba(34,211,238,0.6)]"
    >
      {count}
    </span>
  );
}
