// Round 5 — the compose-axis WINNER (Library), adjusted per the verdict:
// the library sits LEFT as a context-rooted TREE (context → its features and
// goals — the personas primitives), the cut being composed sits RIGHT, and
// the composer is no longer a standalone variant: the Planner opens it for a
// SPECIFIC milestone via its "Compose scope" action. Unit analysis holds:
// features bind (pulling contexts into the derived footprint), goals frame,
// contexts navigate but are never added by hand.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Plus, Sparkles, Target, X } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  LIB_CONTEXTS, LIB_FEATURES, LIB_GOALS, TONE_HUE_MAP, contextTone,
  type LibFeature, type ShipMilestone,
} from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';

const addBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

export function ShipMilestoneComposer({ m, onBack }: { m: ShipMilestone; onBack: () => void }) {
  const reduce = useReducedMotion();
  // Seed the cut from the milestone's existing core scope (matched by name —
  // mock-land stand-in for the real milestone_id join).
  const [cutIds, setCutIds] = useState<string[]>(() =>
    LIB_FEATURES.filter((lf) => m.features.some((f) => f.bucket === 'core' && f.name === lf.name)).map((lf) => lf.id),
  );
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(LIB_CONTEXTS.slice(0, 2).map((c) => c.name)));

  const cut = cutIds.map((id) => LIB_FEATURES.find((f) => f.id === id)).filter((f): f is LibFeature => Boolean(f));
  const boundGoals = LIB_GOALS.filter((g) => goalIds.includes(g.id));

  const footprint = useMemo(() => {
    const names = [...new Set(cut.flatMap((f) => f.contexts))];
    const ctxs = names.map(contextTone);
    return { ctxs, crit: ctxs.filter((c) => c.tone === 'crit').length, unmeasured: ctxs.filter((c) => c.kpis === 0).length };
  }, [cut]);

  const toggle = (name: string) =>
    setOpen((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <div data-testid="factory-ship-composer">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring rounded-interactive mb-3">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        Back to plan
      </button>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.25fr)' }}>
        {/* LEFT — the library as a context-rooted tree */}
        <div className="min-w-0 rounded-modal border border-foreground/[0.08] p-3" style={{ background: 'rgba(148,163,184,.02)' }}>
          <p className="typo-title mb-0.5">Library</p>
          <p className="typo-caption mb-2.5" style={{ color: INK.blue }}>
            Contexts navigate — features and goals beneath them are what you add.
          </p>
          <ul data-testid="ship-lib-tree">
            {LIB_CONTEXTS.map((ctx) => {
              const feats = LIB_FEATURES.filter((f) => f.contexts.includes(ctx.name));
              const goals = LIB_GOALS.filter((g) => g.contexts.includes(ctx.name));
              if (feats.length === 0 && goals.length === 0) return null;
              const isOpen = open.has(ctx.name);
              const hue = TONE_HUE_MAP[ctx.tone];
              const inFp = footprint.ctxs.some((c) => c.name === ctx.name);
              return (
                <li key={ctx.name} className="border-b border-foreground/[0.05] last:border-0">
                  <button
                    type="button"
                    onClick={() => toggle(ctx.name)}
                    className="w-full flex items-center gap-2 py-2 px-1 focus-ring rounded-interactive min-w-0"
                    aria-expanded={isOpen}
                    data-testid={`ship-tree-ctx-${ctx.name}`}
                  >
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-foreground/40 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hue }} />
                    <span className="typo-body font-medium text-foreground/90 truncate">{ctx.name}</span>
                    <span className="ml-auto typo-caption shrink-0">
                      {feats.length > 0 && `${feats.length}f`}{goals.length > 0 && ` ${goals.length}g`}
                      {ctx.kpis === 0 ? ' · no KPI' : ` · ${ctx.kpis} KPI`}{inFp ? ' · in cut' : ''}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.ul
                      className="pb-2 overflow-hidden"
                      initial={reduce ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={reduce ? undefined : { opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {feats.map((f) => {
                        const inCut = cutIds.includes(f.id);
                        return (
                          <li key={f.id} className={`flex items-center gap-2 py-1 pl-8 pr-1 min-w-0 ${inCut ? 'opacity-45' : ''}`}>
                            <Sparkles className="w-3 h-3 shrink-0" style={{ color: INK.violet }} aria-hidden />
                            <span className="typo-caption text-foreground/85 min-w-0">{f.name}</span>
                            <span className="ml-auto">
                              {inCut
                                ? <span className="typo-caption shrink-0">in cut</span>
                                : (
                                  <button type="button" onClick={() => setCutIds((p) => [...p, f.id])} {...addBtn(INK.teal)} aria-label={`Add ${f.name} to the cut`}>
                                    <Plus className="w-3 h-3" aria-hidden />
                                    Cut
                                  </button>
                                )}
                            </span>
                          </li>
                        );
                      })}
                      {goals.map((g) => {
                        const bound = goalIds.includes(g.id);
                        return (
                          <li key={g.id} className={`flex items-center gap-2 py-1 pl-8 pr-1 min-w-0 ${bound ? 'opacity-45' : ''}`}>
                            <Target className="w-3 h-3 shrink-0" style={{ color: INK.teal }} aria-hidden />
                            <span className="typo-caption text-foreground/85 min-w-0">{g.name} · {g.metric}</span>
                            <span className="ml-auto">
                              {bound
                                ? <span className="typo-caption shrink-0">bound</span>
                                : (
                                  <button type="button" onClick={() => setGoalIds((p) => [...p, g.id])} {...addBtn(INK.teal)} aria-label={`Bind ${g.name}`}>
                                    <Plus className="w-3 h-3" aria-hidden />
                                    Bind
                                  </button>
                                )}
                            </span>
                          </li>
                        );
                      })}
                    </motion.ul>
                  )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </div>

        {/* RIGHT — the cut being composed for THIS milestone */}
        <div className="min-w-0">
          <p className="typo-title-lg mb-1">{m.name} — composing the cut</p>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            {boundGoals.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption" style={{ borderColor: `${INK.teal}55`, color: INK.teal }}>
                <Target className="w-3 h-3" aria-hidden />
                {g.name} · {g.metric}
                <button type="button" onClick={() => setGoalIds((p) => p.filter((x) => x !== g.id))} className="focus-ring rounded-full" aria-label={`Unbind ${g.name}`}>
                  <X className="w-3 h-3 opacity-60 hover:opacity-100" aria-hidden />
                </button>
              </span>
            ))}
            {boundGoals.length === 0 && <span className="typo-caption" style={{ color: INK.blue }}>No objective bound yet — bind one from the tree.</span>}
          </div>

          <div className="rounded-card px-3 py-2 mb-3 border border-foreground/[0.07]" style={{ background: 'rgba(148,163,184,.03)' }} data-testid="ship-footprint">
            <span className="typo-caption block mb-1.5">
              Derived footprint — {footprint.ctxs.length} contexts
              {footprint.crit > 0 && <span style={{ color: INK.red }}> · {footprint.crit} critical</span>}
              {footprint.unmeasured > 0 && <span style={{ color: INK.blue }}> · {footprint.unmeasured} without a KPI</span>}
            </span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {footprint.ctxs.map((c) => (
                <span key={c.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs" style={{ borderColor: `${TONE_HUE_MAP[c.tone]}55`, color: TONE_HUE_MAP[c.tone] }} title={`${c.kpis} KPIs`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_HUE_MAP[c.tone] }} />
                  {c.name}{c.kpis === 0 ? ' · no KPI' : ''}
                </span>
              ))}
              {footprint.ctxs.length === 0 && <span className="typo-caption">empty — add a feature and its contexts follow</span>}
            </span>
          </div>

          <LedgerHeader title="The cut" count={cut.length} aside="every row pulled its contexts into the footprint above" />
          <LedgerList testid="ship-compose-cut">
            {cut.map((f, i) => (
              <LedgerRow
                key={f.id}
                index={i}
                name={f.name}
                contexts={f.contexts}
                stateLabel={f.kpiCount > 0 ? `${f.kpiCount} KPI${f.kpiCount > 1 ? 's' : ''}` : 'no KPI yet'}
                stateHue={f.kpiCount > 0 ? INK.emerald : INK.blue}
                actions={
                  <button type="button" onClick={() => setCutIds((p) => p.filter((x) => x !== f.id))} {...addBtn('rgba(148,163,184,.7)')} aria-label={`Remove ${f.name}`}>
                    <X className="w-3 h-3" aria-hidden />
                    Remove
                  </button>
                }
              />
            ))}
            {cut.length === 0 && (
              <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
                Empty cut — add features from the tree.
              </li>
            )}
          </LedgerList>
        </div>
      </div>
    </div>
  );
}
