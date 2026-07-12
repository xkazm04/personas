import { AlertTriangle, Globe } from 'lucide-react';

import type { PreviewRow } from '@/api/scraper';

/**
 * Renders the result of a dry-run extraction (Phase 1b-2): per-URL, a table of
 * each expected field → the value the rules pulled, with empties flagged
 * "no match". Shared by the Wizard's Preview step and the Control Room row test.
 */
export function PreviewResults({ rows, fieldNames }: { rows: PreviewRow[]; fieldNames: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.url} className="rounded-interactive border border-primary/10 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 typo-caption text-muted-foreground">
            <Globe className="size-3.5 shrink-0" />
            <span className="truncate">{row.url}</span>
            {row.error ? (
              <span className="text-status-error">· {row.error}</span>
            ) : (
              <span>· {(row.bytes / 1024).toFixed(0)} KB fetched</span>
            )}
          </div>
          {!row.error && row.record && (
            <table className="w-full">
              <tbody className="divide-y divide-primary/8">
                {fieldNames.map((name) => {
                  const val = (row.record as Record<string, unknown>)[name];
                  const isEmpty =
                    val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
                  return (
                    <tr key={name}>
                      <td className="py-1.5 pr-3 align-top font-mono typo-caption text-muted-foreground">{name}</td>
                      <td className="py-1.5 align-top">
                        {isEmpty ? (
                          <span className="inline-flex items-center gap-1 typo-caption text-status-warning">
                            <AlertTriangle className="size-3" /> no match
                          </span>
                        ) : (
                          <span className="break-words typo-caption text-foreground">{formatPreviewValue(val)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

export function formatPreviewValue(v: unknown): string {
  if (Array.isArray(v)) {
    const shown = v.slice(0, 5).map((x) => String(x)).join(', ');
    return v.length > 5 ? `[${shown}, +${v.length - 5} more]` : `[${shown}]`;
  }
  return String(v);
}
