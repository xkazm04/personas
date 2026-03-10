import { useState, useCallback, useRef } from 'react';
import type { QueryResult } from '@/api/vault/database/dbSchema';
import { AlertTriangle, Clock, Copy, Check } from 'lucide-react';

interface QueryResultTableProps {
  result: QueryResult;
}

export function QueryResultTable({ result }: QueryResultTableProps) {
  // Track which cell/column was just copied for flash feedback
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flashCopied = useCallback((key: string) => {
    setCopiedCell(key);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedCell(null), 1200);
  }, []);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => flashCopied(key)).catch(() => {});
  }, [flashCopied]);

  const handleColumnClick = useCallback((col: string, colIdx: number) => {
    copyToClipboard(col, `col-${colIdx}`);
  }, [copyToClipboard]);

  const handleCellClick = useCallback((cell: unknown, rowIdx: number, colIdx: number) => {
    copyToClipboard(formatCell(cell), `cell-${rowIdx}-${colIdx}`);
  }, [copyToClipboard]);

  if (result.columns.length === 0 && result.rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground/50">
        Query executed successfully. No rows returned.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Table */}
      <div className="rounded-xl border border-primary/10 overflow-hidden">
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-secondary/40 border-b border-primary/10">
                {result.columns.map((col, i) => {
                  const isColCopied = copiedCell === `col-${i}`;
                  return (
                    <th
                      key={i}
                      onClick={() => handleColumnClick(col, i)}
                      className="px-3 py-2 text-left font-semibold text-foreground/70 whitespace-nowrap cursor-pointer select-none hover:bg-primary/8 transition-colors group relative"
                      title={`Click to copy column name: ${col}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isColCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            {col}
                            <Copy className="w-2.5 h-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors shrink-0" />
                          </>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`border-b border-primary/5 ${
                    rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-secondary/8'
                  } hover:bg-secondary/20 transition-colors`}
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
                        className={`px-3 py-1.5 max-w-[300px] cursor-pointer transition-all duration-150 select-text ${
                          isCellCopied
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : isNull
                              ? 'text-muted-foreground/50 italic'
                              : 'text-foreground/75 hover:bg-primary/5'
                        }`}
                        title={isCellCopied ? 'Copied!' : `Click to copy: ${formatCell(cell)}`}
                      >
                        <span className="block truncate">
                          {isCellCopied ? (
                            <span className="flex items-center gap-1">
                              <Check className="w-2.5 h-2.5 shrink-0" />
                              Copied
                            </span>
                          ) : (
                            cellText
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
        <span>{result.row_count} row{result.row_count !== 1 ? 's' : ''}</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {result.duration_ms}ms
        </span>
        {result.truncated && (
          <span className="flex items-center gap-1 text-amber-400/70">
            <AlertTriangle className="w-3 h-3" />
            Results truncated to 500 rows
          </span>
        )}
      </div>
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
