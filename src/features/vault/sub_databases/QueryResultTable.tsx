import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryResult } from '@/api/vault/database/dbSchema';
import { AlertTriangle, Clock, Copy, Check, CheckCircle2 } from 'lucide-react';
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';

const ROW_HEIGHT = 32;

interface QueryResultTableProps {
  result: QueryResult;
}

export function QueryResultTable({ result }: QueryResultTableProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;
  const { copiedKey: copiedCell, copy } = useKeyedCopyFlag<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copyAnnounce, setCopyAnnounce] = useState('');

  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const copyToClipboard = useCallback((text: string, key: string) => {
    copy(key, text);
    const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    setCopyAnnounce(`${db.copied}: ${preview}`);
  }, [copy, db.copied]);

  // Enter/Space activate the copy affordance for keyboard users.
  const onCopyKey = useCallback((e: KeyboardEvent<HTMLElement>, run: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  }, []);

  const handleColumnClick = useCallback((col: string, colIdx: number) => {
    copyToClipboard(col, `col-${colIdx}`);
  }, [copyToClipboard]);

  const handleCellClick = useCallback((cell: unknown, rowIdx: number, colIdx: number) => {
    copyToClipboard(formatCell(cell), `cell-${rowIdx}-${colIdx}`);
  }, [copyToClipboard]);

  if (result.columns.length === 0 && result.rows.length === 0) {
    return (
      <EmptyIllustration
        icon={CheckCircle2}
        heading={db.query_success}
        description={db.no_rows}
        className="py-8"
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-modal border border-primary/10 overflow-hidden">
        {/* Sticky header */}
        <div className="overflow-x-auto">
          <table className="w-full typo-body">
            <thead>
              <tr className="bg-secondary/40 border-b border-primary/10">
                {result.columns.map((col, i) => {
                  const isColCopied = copiedCell === `col-${i}`;
                  return (
                    <th
                      key={i}
                      onClick={() => handleColumnClick(col, i)}
                      onKeyDown={(e) => onCopyKey(e, () => handleColumnClick(col, i))}
                      tabIndex={0}
                      role="button"
                      aria-label={tx(db.click_copy_column, { name: col })}
                      className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap cursor-pointer select-none hover:bg-primary/8 focus:bg-primary/8 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors group relative"
                      title={tx(db.click_copy_column, { name: col })}
                    >
                      <span className="flex items-center gap-1.5">
                        {isColCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="text-emerald-400">{db.copied}</span>
                          </>
                        ) : (
                          <>
                            {col}
                            <Copy className="w-2.5 h-2.5 text-foreground group-hover:text-muted-foreground/40 transition-colors shrink-0" />
                          </>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
          </table>
        </div>

        {/* Virtualized body */}
        <div ref={scrollRef} className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 400 }}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            <table className="w-full typo-body" style={{ position: 'absolute', top: 0, left: 0 }}>
              <tbody>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const rowIdx = virtualRow.index;
                  const row = result.rows[rowIdx]!;
                  return (
                    <tr
                      key={rowIdx}
                      data-index={rowIdx}
                      ref={rowVirtualizer.measureElement}
                      className={`border-b border-primary/5 ${
                        rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-secondary/8'
                      } hover:bg-secondary/20 transition-colors`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {row.map((cell, colIdx) => {
                        const cellKey = `cell-${rowIdx}-${colIdx}`;
                        const isCellCopied = copiedCell === cellKey;
                        const cellText = renderCell(cell);
                        const isNull = cell === null || cell === undefined;

                        return (
                          <td
                            key={colIdx}
                            onClick={() => handleCellClick(cell, rowIdx, colIdx)}
                            onKeyDown={(e) => onCopyKey(e, () => handleCellClick(cell, rowIdx, colIdx))}
                            tabIndex={0}
                            role="button"
                            aria-label={tx(db.click_copy_cell, { value: formatCell(cell) })}
                            className={`px-3 py-1.5 max-w-[300px] cursor-pointer transition-all duration-150 select-text focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
                              isCellCopied
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : isNull
                                  ? 'text-foreground italic'
                                  : 'text-foreground hover:bg-primary/5'
                            }`}
                            title={isCellCopied ? db.copied : tx(db.click_copy_cell, { value: formatCell(cell) })}
                          >
                            <span className="block truncate">
                              {isCellCopied ? (
                                <span className="flex items-center gap-1">
                                  <Check className="w-2.5 h-2.5 shrink-0" />
                                  {db.copied}
                                </span>
                              ) : (
                                cellText
                              )}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 typo-body text-foreground">
        <span>{tx(result.row_count !== 1 ? db.row_count_other : db.row_count_one, { count: result.row_count })}</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {result.duration_ms}ms
        </span>
        {result.truncated && (
          <span className="flex items-center gap-1 text-amber-400/70">
            <AlertTriangle className="w-3 h-3" />
            {db.results_truncated}
          </span>
        )}
      </div>

      {/* Screen-reader announcement for click/keyboard copy (visual badge is in-cell). */}
      <span className="sr-only" role="status" aria-live="polite">{copyAnnounce}</span>
    </div>
  );
}

function renderCell(cell: unknown): string {
  if (cell === null || cell === undefined) return 'NULL';
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'object') return JSON.stringify(cell);
  return String(cell);
}

function formatCell(cell: unknown): string {
  if (cell === null || cell === undefined) return 'NULL';
  if (typeof cell === 'object') return JSON.stringify(cell, null, 2);
  return String(cell);
}
