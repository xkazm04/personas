// Provenance on a triage card (docs/plans/dev-findings-loop.md §3 2D).
//
// A classic Idea-Scanner idea renders NOTHING here (origin is null) — the triage
// deck looks exactly as it did. A sensor finding gets a badge naming the sensor
// that raised it, and a popover showing the raw evidence that justified emission,
// so the user can judge the claim instead of trusting it.
import { useState } from 'react';
import { Activity, AlertTriangle, DollarSign, ClipboardCheck, MoonStar, Target, Info } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FindingOrigin } from '@/api/devTools/devTools';

const ORIGIN_META: Record<
  FindingOrigin,
  { label: string; icon: typeof Activity; tw: string }
> = {
  standards_finding: {
    label: 'Standards',
    icon: ClipboardCheck,
    tw: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  },
  passport_gap: {
    label: 'Readiness',
    icon: Target,
    tw: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
  },
  llm_cost: {
    label: 'LLM cost',
    icon: DollarSign,
    tw: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  },
  sentry_spike: {
    label: 'Errors',
    icon: AlertTriangle,
    tw: 'bg-red-500/10 text-red-300 border-red-500/25',
  },
  kpi_offtrack: {
    label: 'KPI',
    icon: Activity,
    tw: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  },
  skill_dormant: {
    label: 'Dormant skill',
    icon: MoonStar,
    tw: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25',
  },
};

export function originMeta(origin: string) {
  return ORIGIN_META[origin as FindingOrigin];
}

// ---------------------------------------------------------------------------
// Verdict chip (Phase 3A) — did shipping this move the number?
// ---------------------------------------------------------------------------

const VERDICT_META: Record<string, { label: string; tw: string; title: string }> = {
  cleared: {
    label: 'Cleared',
    tw: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    title: 'The sensor no longer reports this signal — it is gone.',
  },
  moved: {
    label: 'Moved',
    tw: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    title: 'The signal is still there, but the number improved materially.',
  },
  // Deliberately NOT quiet. A shipped fix that changed nothing is the single most
  // useful thing this loop can tell you, and the easiest to hide.
  unchanged: {
    label: 'Unchanged',
    tw: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    title: 'Shipped — but the number did not move. Merged is not fixed.',
  },
  regressed: {
    label: 'Regressed',
    tw: 'bg-red-500/20 text-red-300 border-red-500/40',
    title: 'Shipped — and the number got WORSE.',
  },
};

/** Renders nothing for `pending`/null: a finding that hasn't shipped makes no claim. */
export function VerdictChip({ verifyState }: { verifyState: string | null | undefined }) {
  if (!verifyState || verifyState === 'pending') return null;
  const meta = VERDICT_META[verifyState];
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-md font-medium border ${meta.tw}`}
    >
      {meta.label}
    </span>
  );
}

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
  const [open, setOpen] = useState(false);
  const meta = originMeta(origin);
  if (!meta) return null;
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
      <Tooltip content={rows.length > 0 ? 'Why this was raised' : meta.label}>
        <button
          type="button"
          onClick={() => rows.length > 0 && setOpen((v) => !v)}
          aria-expanded={rows.length > 0 ? open : undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-md font-medium border ${meta.tw} ${
            rows.length > 0 ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
          }`}
        >
          <Icon className="w-3 h-3" aria-hidden />
          {meta.label}
          {rows.length > 0 && <Info className="w-2.5 h-2.5 opacity-60" aria-hidden />}
        </button>
      </Tooltip>

      {open && rows.length > 0 && (
        <span
          role="dialog"
          className="absolute top-full left-0 mt-1.5 z-30 min-w-[240px] max-w-[320px] rounded-modal border border-primary/15 bg-background shadow-elevation-3 p-3"
        >
          <span className="block typo-label text-foreground/50 mb-1.5">Evidence</span>
          <dl className="space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="typo-caption text-foreground/55 shrink-0">{humanize(k)}</dt>
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
