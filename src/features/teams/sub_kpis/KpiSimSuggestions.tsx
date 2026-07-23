// KPI simulation suggestions (docs/plans/kpi-simulation-skill.md P3) — the
// ADOPTION surface for the sim's proposal-gated KPI mutations.
//
// The sim ingest lands `adopt_measure_config` / `adjust_target` / `retire`
// proposals as `kpi_sim` findings in the triage spine (never a silent KPI
// edit). Rather than bury them in the generic backlog, this panel surfaces the
// ACTIONABLE ones next to the KPIs they change, each one click to apply:
//
//  - adopt_measure_config → set the KPI to a codebase measure with the authored
//    {cmd,parse}; a `manual`-cadence KPI is bumped to weekly so it then rides
//    the autopilot **Measure** tier for free (no LLM) — this is what closes the
//    "adopted class-1 recipes ride autopilot Measure cadence" P3 loop.
//  - adjust_target → move the target (+ optional date) to the benchmarked value.
//  - retire → archive the KPI.
//
// Applying an item marks its finding `accepted`; Dismiss rejects it (durably —
// a rejected finding is never re-raised). Purely informational findings (no
// actionable `kind`) stay in the triage backlog and are not shown here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Cog, Target, Archive, X, Sparkles } from 'lucide-react';

import { listIdeas, acceptIdea, rejectIdea } from '@/api/devTools/devTools';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

type ActionKind = 'adopt_measure_config' | 'adjust_target' | 'retire';
const ACTION_KINDS: ActionKind[] = ['adopt_measure_config', 'adjust_target', 'retire'];

interface Suggestion {
  ideaId: string;
  kind: ActionKind;
  kpiId: string;
  rationale: string | null;
  citations: string[];
  /** kind-specific payload — {cmd,parse} | {target_value,target_date} | {} */
  payload: Record<string, unknown>;
}

/** Parse a kpi_sim finding into an actionable suggestion, or null when it is
 *  a purely informational finding (no actionable kind / no kpi). */
function parseSuggestion(idea: DevIdea): Suggestion | null {
  if (!idea.evidence) return null;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(idea.evidence) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = ev.kind;
  const kpiId = ev.kpi_id;
  if (typeof kind !== 'string' || !ACTION_KINDS.includes(kind as ActionKind)) return null;
  if (typeof kpiId !== 'string' || !kpiId) return null;
  return {
    ideaId: idea.id,
    kind: kind as ActionKind,
    kpiId,
    rationale: idea.description ?? null,
    citations: Array.isArray(ev.citations) ? (ev.citations as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    payload: (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>,
  };
}

export function KpiSimSuggestions({ projectId, onApplied }: {
  projectId: string;
  /** Refresh trends after an apply (a target move / adopt changes the chart). */
  onApplied?: () => void;
}) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const kpis = useSystemStore((s) => s.kpis);
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const kpiName = useMemo(() => {
    const m = new Map(kpis.map((k) => [k.id, k]));
    return (id: string) => m.get(id) ?? null;
  }, [kpis]);

  const load = useCallback(() => {
    listIdeas(projectId, 'pending', undefined, 'kpi_sim')
      .then((ideas) => setSuggestions(ideas.map(parseSuggestion).filter((s): s is Suggestion => s !== null)))
      .catch(silentCatch('kpiSimSuggestions:load'));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const apply = async (s: Suggestion) => {
    setBusyId(s.ideaId);
    try {
      const kpi = kpiName(s.kpiId);
      if (s.kind === 'adopt_measure_config') {
        const updates: Parameters<typeof updateKpi>[1] = {
          measureKind: 'codebase',
          measureConfig: JSON.stringify(s.payload),
          status: 'active',
        };
        // A manual-cadence KPI would never auto-measure — bump it so the
        // adopted recipe actually rides the Measure tier.
        if (kpi?.cadence === 'manual') updates.cadence = 'weekly';
        await updateKpi(s.kpiId, updates);
      } else if (s.kind === 'adjust_target') {
        const tv = s.payload.target_value;
        await updateKpi(s.kpiId, {
          targetValue: typeof tv === 'number' ? tv : null,
          targetDate: typeof s.payload.target_date === 'string' ? s.payload.target_date : null,
        });
      } else {
        await updateKpi(s.kpiId, { status: 'archived' });
      }
      await acceptIdea(s.ideaId);
      addToast(tx(t.kpis.suggest_applied_toast, { name: kpi?.name ?? 'KPI' }), 'success');
      onApplied?.();
      load();
    } catch (e) {
      toastCatch('kpiSimSuggestions:apply')(e);
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (s: Suggestion) => {
    setBusyId(s.ideaId);
    try {
      await rejectIdea(s.ideaId);
      load();
    } catch (e) {
      toastCatch('kpiSimSuggestions:dismiss')(e);
    } finally {
      setBusyId(null);
    }
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-card border border-violet-400/25 bg-violet-500/[0.06] px-4 py-3" data-testid="kpi-sim-suggestions">
      <h3 className="flex items-center gap-1.5 typo-overline text-foreground mb-2">
        <Sparkles className="w-3.5 h-3.5 text-violet-300" aria-hidden />
        {tx(t.kpis.suggest_title, { count: suggestions.length })}
      </h3>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <SuggestionRow
            key={s.ideaId}
            s={s}
            kpiName={kpiName(s.kpiId)?.name ?? '—'}
            unit={kpiName(s.kpiId)?.unit ?? ''}
            busy={busyId === s.ideaId}
            onApply={() => apply(s)}
            onDismiss={() => dismiss(s)}
          />
        ))}
      </ul>
    </div>
  );
}

const KIND_ICON: Record<ActionKind, typeof Cog> = {
  adopt_measure_config: Cog,
  adjust_target: Target,
  retire: Archive,
};

function SuggestionRow({ s, kpiName, unit, busy, onApply, onDismiss }: {
  s: Suggestion;
  kpiName: string;
  unit: string;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = KIND_ICON[s.kind];

  const headline = (() => {
    if (s.kind === 'adopt_measure_config') {
      const cmd = typeof s.payload.cmd === 'string' ? s.payload.cmd : '';
      return { label: tx(t.kpis.suggest_adopt, { name: kpiName }), detail: cmd };
    }
    if (s.kind === 'adjust_target') {
      const tv = typeof s.payload.target_value === 'number' ? s.payload.target_value : null;
      return {
        label: tx(t.kpis.suggest_adjust, { name: kpiName }),
        detail: tv != null ? `→ ${tv} ${unit}` : '',
      };
    }
    return { label: tx(t.kpis.suggest_retire, { name: kpiName }), detail: '' };
  })();

  return (
    <li className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 mt-0.5 text-violet-300 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="typo-body text-foreground">{headline.label}</span>
          {headline.detail && (
            <span className="typo-caption text-foreground opacity-80 font-mono truncate">{headline.detail}</span>
          )}
          {s.citations.length > 0 && (
            <Tooltip content={s.citations.join('\n')} placement="top">
              <span className="typo-caption text-violet-300/90 cursor-help">
                {tx(t.kpis.suggest_sources, { count: s.citations.length })}
              </span>
            </Tooltip>
          )}
        </div>
        {s.rationale && <p className="typo-caption text-foreground opacity-70 leading-snug">{s.rationale}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="inline-flex items-center gap-1 typo-caption font-medium rounded-interactive border border-violet-400/40 bg-violet-500/15 text-violet-200 px-2 py-0.5 hover:bg-violet-500/25 disabled:opacity-50 transition-colors focus-ring"
          data-testid={`kpi-suggest-apply-${s.kind}`}
        >
          <Check className="w-3 h-3" aria-hidden />
          {t.kpis.suggest_apply}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          aria-label={t.kpis.suggest_dismiss}
          title={t.kpis.suggest_dismiss}
          className="p-1 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-primary/10 disabled:opacity-50 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}
