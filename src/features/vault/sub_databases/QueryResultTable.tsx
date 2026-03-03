import type { QueryResult } from '@/api/dbSchema';
import { AlertTriangle, Clock } from 'lucide-react';

interface QueryResultTableProps {
  result: QueryResult;
}

export function QueryResultTable({ result }: QueryResultTableProps) {
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
      <div className="rounded-lg border border-primary/10 overflow-hidden">
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-secondary/40 border-b border-primary/10">
                {result.columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-semibold text-foreground/70 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`border-b border-primary/5 ${
                    rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'
                  } hover:bg-secondary/20 transition-colors`}
                >
                  {row.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-3 py-1.5 text-foreground/75 max-w-[300px] truncate"
                      title={formatCell(cell)}
                    >
                      {renderCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
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
