import { useEffect } from 'react';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { IntrospectedColumn } from '@/hooks/database/useTableIntrospection';

interface ColumnListProps {
  columns: IntrospectedColumn[];
  columnsLoading: boolean;
  columnsError: string | null;
  isApi: boolean;
  columnLabel: string;
  typeLabel: string;
}

/** Deterministic ghost-bar width variety so ghosts read as rows, not a barcode. */
const GHOST_BAR_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'];
const GHOST_ROWS = 6;

/**
 * The column table is a SURFACE loading its data, so the loading state is a calm
 * geometry-matched ghost UNDER permanent chrome — not a spinner, and not a
 * centred sentence (docs/design/overview-loading.md, laws 1 and 3).
 *
 * This used to `return` a `<LoadingSpinner/>` beside "Loading columns…" before the
 * table ever rendered. `feedback/LoadingSpinner` renders `null`, so what actually
 * painted was a bare centred line of text with no geometry at all, and the header
 * row — which is static chrome and knowable before the fetch resolves — vanished
 * with it. The header now always renders and the ghost rows sit beneath it, so the
 * settle is a swap of row content rather than a relayout of the whole panel.
 *
 * Law 1 is why the ghost is gated on `columns.length === 0` and not on
 * `columnsLoading` alone: a refetch must never hide rows that are already painted.
 */
export function ColumnList({
  columns,
  columnsLoading,
  columnsError,
  isApi,
  columnLabel,
  typeLabel,
}: ColumnListProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;

  // The ghost is silent to assistive tech; the state it conveys visually goes
  // through the app-wide live region instead. A LOCAL `role="status"` would not
  // work here: this component mounts already loading, so the region and its text
  // would enter the accessibility tree in the same commit and there would be no
  // change for a screen reader to observe (census `live-region-born-with-its-message`,
  // docs/concepts/golden-paths/screen-reader-announcements.md). `AriaLiveProvider`'s
  // region is mounted at the app root and is persistent by construction.
  const isColdLoad = columnsLoading && columns.length === 0;
  useEffect(() => {
    if (isColdLoad) announceImperative(db.loading_columns);
  }, [isColdLoad, db.loading_columns]);

  if (columnsError) {
    return (
      <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400 break-words">
        {columnsError}
      </div>
    );
  }

  const showGhost = isColdLoad;

  // Empty only once the fetch has SETTLED — an empty-flash before the first
  // response reads as "this table has no columns", which is a different claim.
  if (!columnsLoading && columns.length === 0) {
    return (
      <p className="typo-body text-foreground text-center py-8">
        {isApi ? db.no_properties : db.no_columns}
      </p>
    );
  }

  const ghostCells = isApi ? 2 : 4;

  return (
    <>
      <div className="rounded-card border border-primary/10 overflow-hidden">
        <table className="w-full typo-body">
          <thead>
            <tr className="bg-secondary/40 border-b border-primary/10">
              <th className="px-3 py-2 text-left font-semibold text-foreground w-1/3">{columnLabel}</th>
              <th className="px-3 py-2 text-left font-semibold text-foreground w-1/4">{typeLabel}</th>
              {!isApi && <th className="px-3 py-2 text-center font-semibold text-foreground w-20">{db.nullable}</th>}
              {!isApi && <th className="px-3 py-2 text-left font-semibold text-foreground">{db.default_val}</th>}
            </tr>
          </thead>
          <tbody>
            {showGhost
              ? Array.from({ length: GHOST_ROWS }).map((_, r) => (
                  /* `animate-fade-in` has fill-mode `both`, so the staggered delay keeps
                     these invisible until 120ms+ — a fetch that resolves fast never
                     paints a ghost at all. No `animate-pulse`, ever. */
                  <tr
                    key={`ghost-${r}`}
                    aria-hidden="true"
                    className={`border-b border-primary/5 animate-fade-in ${r % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
                    style={{ animationDelay: `${120 + r * 35}ms` }}
                  >
                    {Array.from({ length: ghostCells }).map((_, c) => (
                      <td key={c} className="px-3 py-1.5">
                        <span
                          className={`inline-block h-3.5 rounded bg-primary/[0.06] ${GHOST_BAR_WIDTHS[(r + c) % GHOST_BAR_WIDTHS.length]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : columns.map((col, i) => (
                  <tr
                    key={col.column_name}
                    className={`border-b border-primary/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
                  >
                    <td className="px-3 py-1.5 font-mono text-foreground">
                      {col.column_name}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-blue-400/70">
                      {col.data_type}
                    </td>
                    {!isApi && (
                      <td className="px-3 py-1.5 text-center">
                        {col.is_nullable === 'YES' ? (
                          <span className="text-foreground">{db.column_nullable_yes}</span>
                        ) : (
                          <span className="text-amber-400/70 font-medium">{db.not_null}</span>
                        )}
                      </td>
                    )}
                    {!isApi && (
                      <td className="px-3 py-1.5 text-foreground truncate max-w-[200px]" title={col.column_default ?? ''}>
                        {col.column_default ?? (
                          <span className="text-foreground">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!showGhost && (
        <div className="mt-3 typo-body text-foreground">
          {isApi
            ? tx(columns.length !== 1 ? db.property_count_other : db.property_count_one, { count: columns.length })
            : tx(columns.length !== 1 ? db.column_count_other : db.column_count_one, { count: columns.length })}
        </div>
      )}
    </>
  );
}
