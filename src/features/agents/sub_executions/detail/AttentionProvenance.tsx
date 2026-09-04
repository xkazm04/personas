import { Radar } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { parseAttentionMeta } from '../libs/executionOrigin';

/**
 * Provenance row for attention-dispatched runs: renders the `_attention` meta
 * (ledger id, responsibility/charter id, lane) parsed out of the execution's
 * `input_data`. Renders nothing for every other run. Link-shaped text only,
 * no navigation (the ledger has no standalone route to point at yet).
 */
export function AttentionProvenance({ inputData }: { inputData: string | null | undefined }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const meta = parseAttentionMeta(inputData);
  if (!meta) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-card border border-accent/20 bg-accent/5 typo-caption">
      <Radar className="w-3.5 h-3.5 text-accent shrink-0" />
      <span className="text-foreground">{e.attention_provenance}</span>
      {meta.lane && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-card bg-accent/10 text-accent border border-accent/20 typo-code">
          {e.attention_lane}: {meta.lane}
        </span>
      )}
      {meta.ledgerId && (
        <span className="typo-code text-primary/80">
          {e.attention_ledger_entry}: {meta.ledgerId}
        </span>
      )}
      {meta.responsibilityId && (
        <span className="typo-code text-primary/80">
          {e.attention_responsibility}: {meta.responsibilityId}
        </span>
      )}
    </div>
  );
}
