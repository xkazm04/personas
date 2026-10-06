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
import { Sparkles } from 'lucide-react';

import { listIdeas } from '@/api/devTools/devTools';
import { decideIdeaRow } from '@/lib/decisions/rowWrites';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { parseSuggestion, type Suggestion } from './kpiSimModel';
import { SuggestionRow, suggestionHeadline } from './KpiSuggestionRow';
import { KpiSuggestionDetail } from './KpiSuggestionDetail';

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
  // Which suggestion's full rationale is open. The row shows a teaser; the
  // markdown body belongs in the shared modal, not in a ledger line.
  const [openId, setOpenId] = useState<string | null>(null);

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
      // The suggestion list only ever renders pending ideas, so that is the
      // status this surface saw — see `decideIdeaRow`.
      await decideIdeaRow(s.ideaId, 'accept', { seenStatus: 'pending' });
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
      await decideIdeaRow(s.ideaId, 'reject', { seenStatus: 'pending' });
      load();
    } catch (e) {
      toastCatch('kpiSimSuggestions:dismiss')(e);
    } finally {
      setBusyId(null);
    }
  };

  const open = suggestions.find((x) => x.ideaId === openId) ?? null;
  const openHeadline = open
    ? suggestionHeadline(open, kpiName(open.kpiId)?.name ?? '—', kpiName(open.kpiId)?.unit ?? '', t, tx)
    : { label: '', detail: '' };

  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-card border border-violet-400/25 bg-violet-500/[0.06] px-4 py-3" data-testid="kpi-sim-suggestions">
      <h3 className="flex items-center gap-1.5 typo-eyebrow text-foreground mb-2">
        <Sparkles className="w-3.5 h-3.5 text-violet-300" aria-hidden />
        {tx(t.kpis.suggest_title, { count: suggestions.length })}
      </h3>
      {/* Divided rows rather than spaced cards: each suggestion is one line of
          a ledger - what, why, and the two decisions - so a column of five
          reads as a table, not a pile. */}
      <ul className="divide-y divide-violet-400/15 border-t border-violet-400/15">
        {suggestions.map((s) => (
          <SuggestionRow
            key={s.ideaId}
            s={s}
            kpiName={kpiName(s.kpiId)?.name ?? '—'}
            unit={kpiName(s.kpiId)?.unit ?? ''}
            busy={busyId === s.ideaId}
            onApply={() => apply(s)}
            onDismiss={() => dismiss(s)}
            onOpen={() => setOpenId(s.ideaId)}
          />
        ))}
      </ul>
      {open && (
        <KpiSuggestionDetail
          s={open}
          title={openHeadline.label}
          detail={openHeadline.detail}
          busy={busyId === open.ideaId}
          onApply={() => { setOpenId(null); void apply(open); }}
          onDismiss={() => { setOpenId(null); void dismiss(open); }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
