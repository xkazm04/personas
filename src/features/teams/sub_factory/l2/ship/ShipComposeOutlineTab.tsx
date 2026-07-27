// Compose variant B (round 4) — OUTLINE. Top-down: start from the milestone's
// PROMISE, decompose it into deliverables, then bind primitives under each.
// The scans work FOR the outline: each deliverable surfaces matching features
// as dashed suggestion rows (accept or skip), accepted rows are real scope,
// and every deliverable footer shows the contexts + gaps it just pulled in.
// Same unit analysis as Library: features bind, contexts derive, the goal is
// the measurable frame at the top.
import { useMemo, useState } from 'react';
import { Check, Plus, Sparkles, Target, X } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import { GROWTH_NAME, LIB_FEATURES, LIB_GOALS, TONE_HUE_MAP, contextTone } from './shipModel';
import { LedgerList, LedgerRow } from './shipRows';

interface Deliverable {
  id: string;
  title: string;
  promise: string;
  suggestedIds: string[];
}

const DELIVERABLES: Deliverable[] = [
  { id: 'd1', title: 'Share with a teammate', promise: 'A persona built alone becomes a persona a team runs.', suggestedIds: ['lf1', 'lf2'] },
  { id: 'd2', title: 'Keep costs visible', promise: 'No one gets surprised by an LLM bill.', suggestedIds: ['lf3', 'lf4'] },
  { id: 'd3', title: 'Come back tomorrow', promise: 'The second week is where retention is won.', suggestedIds: ['lf5', 'lf6'] },
];

const lib = (id: string) => LIB_FEATURES.find((f) => f.id === id);

export function ShipComposeOutlineTab() {
  // accepted: deliverableId → feature ids bound; skipped: suggestion ids dismissed.
  const [accepted, setAccepted] = useState<Record<string, string[]>>({ d1: ['lf1'] });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const accept = (d: string, id: string) => setAccepted((p) => ({ ...p, [d]: [...(p[d] ?? []), id] }));
  const unbind = (d: string, id: string) => setAccepted((p) => ({ ...p, [d]: (p[d] ?? []).filter((x) => x !== id) }));
  const skip = (id: string) => setSkipped((p) => new Set(p).add(id));

  const allBound = Object.values(accepted).flat();
  const footprint = useMemo(() => {
    const names = [...new Set(allBound.map(lib).flatMap((f) => f?.contexts ?? []))];
    return names.map(contextTone);
  }, [allBound]);
  const goal = LIB_GOALS[0];

  return (
    <div className="max-w-3xl" data-testid="factory-ship-compose-outline">
      {/* the promise — the measurable frame everything hangs from */}
      <p className="typo-title-lg">{GROWTH_NAME}</p>
      <p className="typo-body text-foreground/70 mb-1.5">
        Returning users share personas with a teammate and keep run costs visible.
      </p>
      {goal && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption mb-4" style={{ borderColor: `${INK.teal}55`, color: INK.teal }}>
          <Target className="w-3 h-3" aria-hidden />
          {goal.name} · {goal.metric}
        </span>
      )}

      {/* the deliverables */}
      <div className="grid gap-3.5 mt-2">
        {DELIVERABLES.map((d, i) => {
          const bound = (accepted[d.id] ?? []).map(lib).filter((f): f is NonNullable<ReturnType<typeof lib>> => Boolean(f));
          const suggestions = d.suggestedIds
            .filter((id) => !allBound.includes(id) && !skipped.has(id))
            .map(lib)
            .filter((f): f is NonNullable<ReturnType<typeof lib>> => Boolean(f));
          const ctxs = [...new Set(bound.flatMap((f) => f.contexts))].map(contextTone);
          return (
            <section key={d.id} className="rounded-modal border border-foreground/[0.08] p-3.5" style={{ background: 'rgba(148,163,184,.025)' }}>
              <div className="flex items-baseline gap-2.5 mb-0.5">
                <span className="typo-data text-foreground/30">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="typo-title">{d.title}</h3>
                <span className="ml-auto typo-caption shrink-0">{bound.length} bound</span>
              </div>
              <p className="typo-caption mb-2.5 pl-7">{d.promise}</p>

              <LedgerList>
                {bound.map((f) => (
                  <LedgerRow
                    key={f.id}
                    name={f.name}
                    contexts={f.contexts}
                    stateLabel={f.kpiCount > 0 ? `${f.kpiCount} KPI${f.kpiCount > 1 ? 's' : ''}` : 'no KPI yet'}
                    stateHue={f.kpiCount > 0 ? INK.emerald : INK.blue}
                    actions={
                      <button type="button" onClick={() => unbind(d.id, f.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border border-foreground/[0.14] text-foreground/50 hover:text-foreground/85 transition-colors focus-ring" aria-label={`Unbind ${f.name}`}>
                        <X className="w-3 h-3" aria-hidden />
                        Unbind
                      </button>
                    }
                  />
                ))}
                {suggestions.map((f) => (
                  <LedgerRow
                    key={f.id}
                    name={f.name}
                    contexts={f.contexts}
                    dashed
                    marker={<Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden />}
                    meta={<span className="typo-caption shrink-0" style={{ color: INK.violet }}>suggested by scan</span>}
                    actions={
                      <>
                        <button type="button" onClick={() => accept(d.id, f.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring" style={{ color: INK.emerald, borderColor: `${INK.emerald}55` }}>
                          <Check className="w-3 h-3" aria-hidden />
                          Bind
                        </button>
                        <button type="button" onClick={() => skip(f.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border border-foreground/[0.14] text-foreground/50 hover:text-foreground/85 transition-colors focus-ring">
                          Skip
                        </button>
                      </>
                    }
                  />
                ))}
                {bound.length === 0 && suggestions.length === 0 && (
                  <li className="rounded-card border border-dashed px-3 py-3 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
                    Nothing bound — <button type="button" className="underline focus-ring rounded-interactive"><Plus className="w-3 h-3 inline" aria-hidden /> add a feature manually</button> or rescan for candidates.
                  </li>
                )}
              </LedgerList>

              {ctxs.length > 0 && (
                <p className="flex items-center gap-1.5 flex-wrap mt-2 pl-1">
                  <span className="typo-caption shrink-0">pulls in</span>
                  {ctxs.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs" style={{ borderColor: `${TONE_HUE_MAP[c.tone]}55`, color: TONE_HUE_MAP[c.tone] }}>
                      {c.name}{c.kpis === 0 ? ' · no KPI' : ''}{c.tone === 'crit' ? ' · critical' : ''}
                    </span>
                  ))}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/* the running total */}
      <p className="typo-caption mt-3" data-testid="ship-outline-total">
        Outline total: {allBound.length} features · {footprint.length} contexts
        {footprint.filter((c) => c.kpis === 0).length > 0 && <span style={{ color: INK.blue }}> · {footprint.filter((c) => c.kpis === 0).length} without a KPI — the exit criteria will ask for these</span>}
      </p>
    </div>
  );
}
