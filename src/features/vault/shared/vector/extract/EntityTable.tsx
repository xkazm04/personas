import { ScanLine } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { KbEntity } from '@/api/vault/database/vectorKb';

/** Passages below this confidence were read off mostly-image pages. */
const PARTIAL_CONFIDENCE = 0.99;

/**
 * Extracted entities as a flat table, grouped by type. Attributes are shown as
 * compact key:value pairs; the source column carries the document + page so a
 * row stays traceable to where it came from.
 */
export function EntityTable({ entities }: { entities: KbEntity[] }) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;

  if (entities.length === 0) {
    return <p className="typo-body text-foreground px-4 py-6">{sh.extract_no_entities}</p>;
  }

  return (
    <table className="w-full text-left">
      <thead>
        <tr className="typo-caption text-foreground border-b border-border/30">
          <th className="py-1.5 pr-3 font-normal">{sh.extract_col_type}</th>
          <th className="py-1.5 px-3 font-normal">{sh.extract_col_key}</th>
          <th className="py-1.5 px-3 font-normal">{sh.extract_col_attrs}</th>
          <th className="py-1.5 pl-3 font-normal">{sh.extract_col_source}</th>
        </tr>
      </thead>
      <tbody>
        {entities.map((e) => {
          const partial = e.extractionConfidence < PARTIAL_CONFIDENCE;
          const attrs = e.attributes && typeof e.attributes === 'object' ? e.attributes : {};
          return (
            <tr key={e.id} className="typo-body text-foreground border-b border-border/15 align-top">
              <td className="py-1.5 pr-3">
                <span className="font-mono typo-code text-violet-400/80">{e.entityType}</span>
              </td>
              <td className="py-1.5 px-3">
                <span className="inline-flex items-center gap-1.5">
                  {partial && (
                    <Tooltip content={sh.partial_text_tooltip}>
                      <ScanLine className="w-3 h-3 text-amber-400/80" aria-hidden />
                    </Tooltip>
                  )}
                  {e.entityKey}
                </span>
              </td>
              <td className="py-1.5 px-3">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {Object.entries(attrs as Record<string, unknown>).map(([k, v]) => (
                    <span key={k} className="typo-caption text-foreground">
                      <span className="text-primary/70">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-1.5 pl-3 typo-caption text-foreground">
                {e.documentTitle ?? '—'}
                {e.sourcePage != null && (
                  <span className="ml-1.5 text-primary/80">{tx(sh.page_label, { page: e.sourcePage })}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
