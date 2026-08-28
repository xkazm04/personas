import { importanceColor, importanceGradient } from '../libs/memoryVisualTokens';

// The only surviving export of what used to be this module's row/badge kit.
//
// `MemoryRow` (a ~140-line row with its own delete-confirm timer),
// `CapabilityScopeBadge`, `ImportanceDots` (a deprecated alias) and
// `DEFAULT_MEMORY_GRID` were removed here: the Baseline virtualized list they
// belonged to was retired in favour of the Dense table, and afterwards their
// ONLY reference anywhere in the repo was the `sub_memories/index.ts` barrel,
// which itself had zero importers. `DEFAULT_MEMORY_GRID` was documented as
// "kept in sync with MEMORY_COLUMNS in MemoriesPage" — a constant that had
// already ceased to exist, which is what dead code does to the comments
// around it.
//
// `ImportanceBar` stays because MemoryDetailModal imports it directly.

// -- Importance bar (1-5 scale, matching API's IMPORTANCE_MAX) -----------------
// Colors come from the single `memoryVisualTokens` source so the bar, the stats
// ring, the dense matrix, and the graph never disagree on the importance scale.
export function ImportanceBar({ value }: { value: number }) {
  const maxScale = 5;
  const pct = (Math.max(1, Math.min(value, maxScale)) / maxScale) * 100;
  const label = `Importance: ${value} of ${maxScale}`;
  const highImportance = value >= 4;

  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={label}>
      <div
        className="relative w-10 h-1.5 rounded-full bg-muted-foreground/15 overflow-hidden"
        style={highImportance ? { boxShadow: `0 1px 4px ${importanceColor(value)}60` } : undefined}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: importanceGradient(value) }}
        />
      </div>
      <span className="typo-caption text-foreground tabular-nums">{value}/{maxScale}</span>
    </div>
  );
}
