// The milestone composer (wired): context-rooted tree of REAL primitives on
// the left (contexts navigate; their use cases add to the cut, their goals
// bind as objectives), the milestone's live core cut on the right. Every add /
// remove is a dev_milestone_items write; the derived footprint re-computes in
// useShipData on refetch. Contexts remain read-only members-by-derivation.
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Plus, Sparkles, Target, X } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import { TONE_HUE_MAP, type ShipMilestoneVM } from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';
import type { ShipData } from './useShipData';

const addBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

export function ShipMilestoneComposer({ vm, ship, onBack }: {
  vm: ShipMilestoneVM;
  ship: ShipData;
  onBack: () => void;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<Set<string>>(() => new Set(ship.contexts.slice(0, 2).map((c) => c.id)));

  const coreIds = new Set(vm.members.filter((m) => m.bucket === 'core').map((m) => m.feature.id));
  const boundGoalIds = new Set(vm.boundGoals.map((g) => g.id));
  const cut = vm.members.filter((m) => m.bucket === 'core');

  const toggle = (id: string) =>
    setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div data-testid="factory-ship-composer">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring rounded-interactive mb-3">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        Back to plan
      </button>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.25fr)' }}>
        {/* LEFT — the library as a context-rooted tree over real primitives */}
        <div className="min-w-0 rounded-modal border border-foreground/[0.08] p-3" style={{ background: 'rgba(148,163,184,.02)' }}>
          <p className="typo-title mb-0.5">Library</p>
          <p className="typo-caption mb-2.5" style={{ color: INK.blue }}>
            Contexts navigate — the use cases and goals beneath them are what you add.
          </p>
          <ul data-testid="ship-lib-tree">
            {ship.contexts.map((ctx) => {
              const feats = ship.features.filter((f) => f.contexts.includes(ctx.name));
              const goals = ship.goals.filter((g) => g.contexts.includes(ctx.name));
              if (feats.length === 0 && goals.length === 0) return null;
              const isOpen = open.has(ctx.id);
              const hue = TONE_HUE_MAP[ctx.tone];
              const inFp = vm.footprint.some((c) => c.id === ctx.id);
              return (
                <li key={ctx.id} className="border-b border-foreground/[0.05] last:border-0">
                  <button
                    type="button"
                    onClick={() => toggle(ctx.id)}
                    className="w-full flex items-center gap-2 py-2 px-1 focus-ring rounded-interactive min-w-0"
                    aria-expanded={isOpen}
                    data-testid={`ship-tree-ctx-${ctx.id}`}
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
                        const inCut = coreIds.has(f.id);
                        return (
                          <li key={f.id} className={`flex items-center gap-2 py-1 pl-8 pr-1 min-w-0 ${inCut ? 'opacity-45' : ''}`}>
                            <Sparkles className="w-3 h-3 shrink-0" style={{ color: INK.violet }} aria-hidden />
                            <span className="typo-caption text-foreground/85 min-w-0">{f.name}</span>
                            <span className="ml-auto">
                              {inCut
                                ? <span className="typo-caption shrink-0">in cut</span>
                                : (
                                  <button type="button" onClick={() => ship.setItem(vm.id, 'use_case', f.id, 'core')} {...addBtn(INK.teal)} aria-label={`Add ${f.name} to the cut`}>
                                    <Plus className="w-3 h-3" aria-hidden />
                                    Cut
                                  </button>
                                )}
                            </span>
                          </li>
                        );
                      })}
                      {goals.map((g) => {
                        const bound = boundGoalIds.has(g.id);
                        return (
                          <li key={g.id} className={`flex items-center gap-2 py-1 pl-8 pr-1 min-w-0 ${bound ? 'opacity-45' : ''}`}>
                            <Target className="w-3 h-3 shrink-0" style={{ color: INK.teal }} aria-hidden />
                            <span className="typo-caption text-foreground/85 min-w-0">{g.name}</span>
                            <span className="ml-auto">
                              {bound
                                ? <span className="typo-caption shrink-0">bound</span>
                                : (
                                  <button type="button" onClick={() => ship.setItem(vm.id, 'goal', g.id, 'core')} {...addBtn(INK.teal)} aria-label={`Bind ${g.name}`}>
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

        {/* RIGHT — the live cut for THIS milestone */}
        <div className="min-w-0">
          <p className="typo-title-lg mb-1">{vm.name} — composing the cut</p>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            {vm.boundGoals.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption" style={{ borderColor: `${INK.teal}55`, color: INK.teal }}>
                <Target className="w-3 h-3" aria-hidden />
                {g.name}
                <button type="button" onClick={() => ship.removeItem(vm.id, 'goal', g.id)} className="focus-ring rounded-full" aria-label={`Unbind ${g.name}`}>
                  <X className="w-3 h-3 opacity-60 hover:opacity-100" aria-hidden />
                </button>
              </span>
            ))}
            {vm.boundGoals.length === 0 && <span className="typo-caption" style={{ color: INK.blue }}>No objective bound yet — bind one from the tree.</span>}
          </div>

          <div className="rounded-card px-3 py-2 mb-3 border border-foreground/[0.07]" style={{ background: 'rgba(148,163,184,.03)' }} data-testid="ship-footprint">
            <span className="typo-caption block mb-1.5">
              Derived footprint — {vm.footprint.length} contexts
              {vm.footprint.filter((c) => c.tone === 'crit').length > 0 && <span style={{ color: INK.red }}> · {vm.footprint.filter((c) => c.tone === 'crit').length} critical</span>}
              {vm.footprint.filter((c) => c.kpis === 0).length > 0 && <span style={{ color: INK.blue }}> · {vm.footprint.filter((c) => c.kpis === 0).length} without a KPI</span>}
            </span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {vm.footprint.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs" style={{ borderColor: `${TONE_HUE_MAP[c.tone]}55`, color: TONE_HUE_MAP[c.tone] }} title={`${c.kpis} KPIs`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_HUE_MAP[c.tone] }} />
                  {c.name}{c.kpis === 0 ? ' · no KPI' : ''}
                </span>
              ))}
              {vm.footprint.length === 0 && <span className="typo-caption">empty — add a use case and its contexts follow</span>}
            </span>
          </div>

          <LedgerHeader title="The cut" count={cut.length} aside="every row pulled its contexts into the footprint above" />
          <LedgerList testid="ship-compose-cut">
            {cut.map((m, i) => (
              <LedgerRow
                key={m.feature.id}
                index={i}
                name={m.feature.name}
                contexts={m.feature.contexts}
                stateLabel={m.feature.kpiCount > 0 ? `${m.feature.kpiCount} KPI${m.feature.kpiCount > 1 ? 's' : ''}` : 'no KPI yet'}
                stateHue={m.feature.kpiCount > 0 ? INK.emerald : INK.blue}
                meta={m.afterCut ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>added after the cut</span> : undefined}
                actions={
                  <button type="button" onClick={() => ship.removeItem(vm.id, 'use_case', m.feature.id)} {...addBtn('rgba(148,163,184,.7)')} aria-label={`Remove ${m.feature.name}`}>
                    <X className="w-3 h-3" aria-hidden />
                    Remove
                  </button>
                }
              />
            ))}
            {cut.length === 0 && (
              <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
                Empty cut — add use cases from the tree.
              </li>
            )}
          </LedgerList>
        </div>
      </div>
    </div>
  );
}
