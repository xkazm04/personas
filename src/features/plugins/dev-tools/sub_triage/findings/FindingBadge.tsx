// Provenance on a triage card (docs/plans/dev-findings-loop.md §3 2D).
//
// A classic Idea-Scanner idea renders NOTHING here (origin is null) — the triage
// deck looks exactly as it did. A sensor finding gets a badge naming the sensor
// that raised it, and a popover showing the raw evidence that justified emission,
// so the user can judge the claim instead of trusting it.
//
// The sensor identity lives in findingOrigins.ts and the verdict chip in
// VerdictChip.tsx; both are re-exported here, the path the Backlog imports.
import { useState } from 'react';
import { Info } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { originMeta, useOriginLabel } from './findingOrigins';

export { originMeta, useOriginLabel } from './findingOrigins';
export { VerdictChip } from './VerdictChip';

/** Human-readable key: `costUsd` → "cost usd". Evidence keys are machine names; the
 *  user shouldn't have to read camelCase to judge a finding. */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/**
 * The sensor badge + its evidence. `evidence` is the JSON string stored on the
 * idea; malformed JSON degrades to just the badge rather than breaking the card.
 */
export function FindingBadge({
  origin,
  evidence,
}: {
  origin: string;
  evidence?: string | null;
}) {
  const { t } = useTranslation();
  const originLabel = useOriginLabel();
  const [open, setOpen] = useState(false);
  const meta = originMeta(origin);
  if (!meta) return null;
  const label = originLabel(origin);
  const Icon = meta.icon;

  let rows: [string, unknown][] = [];
  if (evidence) {
    try {
      const parsed: unknown = JSON.parse(evidence);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows = Object.entries(parsed as Record<string, unknown>);
      }
    } catch {
      // Malformed evidence shouldn't cost the user their badge — show it bare.
      rows = [];
    }
  }

  return (
    <span className="relative inline-flex">
      <Tooltip content={rows.length > 0 ? t.plugins.dev_triage.origin_why_raised : label}>
        <button
          type="button"
          onClick={() => rows.length > 0 && setOpen((v) => !v)}
          aria-expanded={rows.length > 0 ? open : undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 typo-data border ${meta.tw} ${
            rows.length > 0 ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
          }`}
        >
          <Icon className="w-3 h-3" aria-hidden />
          {label}
          {rows.length > 0 && <Info className="w-2.5 h-2.5 opacity-60" aria-hidden />}
        </button>
      </Tooltip>

      {open && rows.length > 0 && (
        <span
          role="dialog"
          className="absolute top-full left-0 mt-1.5 z-30 min-w-60 max-w-80 rounded-modal border border-primary/15 bg-background shadow-elevation-3 p-3"
        >
          <span className="block typo-label mb-1.5">{t.plugins.dev_triage.origin_evidence}</span>
          <dl className="space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="typo-caption shrink-0">{humanize(k)}</dt>
                <dd className="typo-caption text-foreground tabular-nums text-right break-all">
                  {renderValue(v)}
                </dd>
              </div>
            ))}
          </dl>
        </span>
      )}
    </span>
  );
}
