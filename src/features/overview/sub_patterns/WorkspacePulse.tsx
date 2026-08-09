// Workspace pulse — the library's own dashboard: four health pillars and the
// week's governance activity, both computed on the fly (see libraryPulse.ts;
// nothing here is stored).
//
// It sits above the library because the questions it answers are the ones you
// have *before* opening a row: is this canon being governed, is it going stale,
// does it obey its own structure, and is any of it actually reaching the repos?
import { useMemo, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';
import { useTranslation } from '@/i18n/useTranslation';

import {
  computeDigest,
  computeHealth,
  countToProcess,
  type Pillar,
  type PillarKey,
} from './libraryPulse';
import type { KnowledgeItemView } from './libraryModel';

/** Health reads green only when it is genuinely healthy — the thresholds are
 *  deliberately unforgiving, because a pillar that shows green at 60% teaches
 *  you to ignore it. */
function toneFor(score: number): string {
  if (score >= 0.8) return 'text-status-success';
  if (score >= 0.5) return 'text-status-warning';
  return 'text-status-error';
}

function PillarMeter({ pillar, label, hint }: { pillar: Pillar; label: string; hint: string }) {
  const { score, of } = pillar;
  return (
    <Tooltip content={hint}>
      <div className="flex flex-col gap-1 min-w-0">
        <span className="typo-label text-muted-foreground truncate">
          {label}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className={`typo-body-lg tabular-nums ${score === null ? 'text-muted-foreground' : toneFor(score)}`}
          >
            {score === null ? '—' : `${Math.round(score * 100)}%`}
          </span>
          {of > 0 && (
            <span className="typo-caption text-muted-foreground tabular-nums">/{of}</span>
          )}
        </div>
        <div className="h-1 rounded-full bg-secondary/50 overflow-hidden">
          {score !== null && (
            <div
              className={`h-full rounded-full ${toneFor(score).replace('text-', 'bg-')}`}
              style={{ width: `${Math.max(2, Math.round(score * 100))}%` }}
            />
          )}
        </div>
      </div>
    </Tooltip>
  );
}

function Tally({ count, label, onClick }: { count: number; label: string; onClick?: () => void }) {
  if (count === 0) return null;
  const inner = (
    <>
      <span className="typo-body text-foreground tabular-nums">{count}</span>
      <span className="typo-caption text-muted-foreground">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-baseline gap-1 hover:opacity-80">
      {inner}
    </button>
  ) : (
    <span className="flex items-baseline gap-1">{inner}</span>
  );
}

export function WorkspacePulse({
  items,
  adoptions,
  onOpenPractice,
}: {
  items: readonly KnowledgeItemView[];
  adoptions: readonly WorkspacePracticeAdoption[];
  onOpenPractice?: (item: KnowledgeItemView) => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [open, setOpen] = useState(false);

  // `now` is captured once per mount on purpose — a clock that ticks would
  // re-window the digest mid-review and shuffle rows under the cursor.
  const now = useMemo(() => new Date().toISOString(), []);
  const digest = useMemo(() => computeDigest(items, now), [items, now]);
  const health = useMemo(() => computeHealth(items, adoptions, now), [items, adoptions, now]);
  const toProcess = useMemo(() => countToProcess(items, adoptions), [items, adoptions]);

  const pillarCopy: Record<PillarKey, { label: string; hint: string }> = {
    governance: { label: w.pulse_governance, hint: w.pulse_governance_hint },
    currency: { label: w.pulse_currency, hint: w.pulse_currency_hint },
    consistency: { label: w.pulse_consistency, hint: w.pulse_consistency_hint },
    liquidity: { label: w.pulse_liquidity, hint: w.pulse_liquidity_hint },
  };

  const sections: { key: string; label: string; rows: KnowledgeItemView[] }[] = [
    { key: 'adopted', label: w.pulse_adopted, rows: digest.adopted },
    { key: 'rejected', label: w.pulse_rejected, rows: digest.rejected },
    { key: 'deprecated', label: w.pulse_deprecated, rows: digest.deprecated },
    { key: 'harvested', label: w.pulse_harvested, rows: digest.harvested },
  ].filter((s) => s.rows.length > 0);

  return (
    <section className="rounded-card border border-primary/10 px-3 py-2.5">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <Activity className="w-3.5 h-3.5 text-primary" aria-hidden />
          <span className="typo-label text-foreground">
            {w.pulse_title}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2 flex-1 min-w-0">
          {health.pillars.map((p) => (
            <PillarMeter
              key={p.key}
              pillar={p}
              label={pillarCopy[p.key].label}
              hint={pillarCopy[p.key].hint}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 shrink-0 border-l border-primary/10 pl-4">
          <div className="flex flex-col gap-0.5">
            <span className="typo-label text-muted-foreground">
              {tx(w.pulse_window, { days: digest.days })}
            </span>
            <div className="flex items-baseline gap-3 flex-wrap">
              {digest.quiet ? (
                <span className="typo-caption text-muted-foreground">{w.pulse_quiet}</span>
              ) : (
                <>
                  <Tally count={digest.adopted.length} label={w.pulse_adopted} />
                  <Tally count={digest.rejected.length} label={w.pulse_rejected} />
                  <Tally count={digest.deprecated.length} label={w.pulse_deprecated} />
                  <Tally count={digest.harvested.length} label={w.pulse_harvested} />
                </>
              )}
            </div>
          </div>
          {sections.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? w.collapse : w.expand}
              className="p-1 text-foreground/60 hover:text-foreground"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {(digest.pending.length > 0 || toProcess > 0) && (
        <p className="typo-caption text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
          {digest.pending.length > 0 && (
            <span>{tx(w.pulse_pending, { count: digest.pending.length })}</span>
          )}
          {/* The other half of the ladder: adoption is only real once some repo
              owes work for it. These cells are what an executor will drain. */}
          {toProcess > 0 && (
            <span className="text-status-warning">
              {tx(w.pulse_to_process, { count: toProcess })}
            </span>
          )}
        </p>
      )}

      {open && sections.length > 0 && (
        <div className="mt-3 pt-3 border-t border-primary/10 flex flex-col gap-3">
          {sections.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <span className="typo-label text-muted-foreground">
                {s.label} · {s.rows.length}
              </span>
              {s.rows.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onOpenPractice?.(r)}
                  disabled={!onOpenPractice}
                  className="typo-body text-left text-foreground/80 hover:text-foreground truncate disabled:cursor-default"
                >
                  {r.title}
                </button>
              ))}
              {s.rows.length > 8 && (
                <span className="typo-caption text-muted-foreground">
                  {tx(w.pulse_and_more, { count: s.rows.length - 8 })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
