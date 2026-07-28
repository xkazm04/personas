// The milestone composer (wired): context-rooted tree of REAL primitives on
// the left (contexts navigate; their use cases add to the cut, their goals
// bind as objectives), the milestone's live core cut on the right. Every add /
// remove is a dev_milestone_items write; the derived footprint re-computes in
// useShipData on refetch. Contexts remain read-only members-by-derivation —
// but every context offers a QUICK-ADD so a thin library never dead-ends, and
// an unscanned project gets a motionized empty state whose one follow-up is
// the context scan itself.
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Loader2, Plus, ScanSearch, Sparkles, Target, X } from 'lucide-react';

import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { SCOPE_MAP_GLYPH } from '@/features/shared/glyph/glyphs/scopeMapGlyph';

import { INK } from '../../passport/passportInk';
import { TONE_HUE_MAP, type ShipContext, type ShipMilestoneVM } from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';
import type { ShipData } from './useShipData';

const addBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

/** Inline use-case creation under a context — the "library is thin" escape
 *  hatch. Creates a real dev_use_case sliced to this context. */
function QuickAddUseCase({ ctx, onAdd }: { ctx: ShipContext; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = () => { if (name.trim()) { onAdd(name.trim()); setName(''); } };
  return (
    <li className="flex items-center gap-1.5 py-1 pl-8 pr-1">
      <Plus className="w-3 h-3 shrink-0 text-foreground/35" aria-hidden />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={`New use case in ${ctx.name}…`}
        className="min-w-0 flex-1 rounded-input border border-foreground/[0.1] bg-transparent px-2 py-1 typo-caption text-foreground/90 placeholder:text-foreground/30 focus-ring"
        data-testid={`ship-quickadd-${ctx.id}`}
      />
      {name.trim() && (
        <button type="button" onClick={submit} {...addBtn(INK.teal)}>Add</button>
      )}
    </li>
  );
}

/** The unscanned-project empty state — the map is literally uncharted, and
 *  the ONE follow-up is charting it. */
function UnchartedEmptyState({ ship }: { ship: ShipData }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-8" data-testid="ship-lib-empty">
      <MotionizedGlyph data={SCOPE_MAP_GLYPH.data} viewBox={SCOPE_MAP_GLYPH.viewBox} className="w-36 h-36" glow />
      <p className="typo-title mt-3">Nothing mapped yet</p>
      <p className="typo-caption mt-1 max-w-xs">
        A context scan charts the codebase into areas — use cases and goals hang off them, and milestones are cut from those.
      </p>
      <button
        type="button"
        onClick={ship.scanContexts}
        disabled={ship.ctxScanning}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring disabled:opacity-50"
        style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
        data-testid="ship-lib-scan"
      >
        {ship.ctxScanning
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          : <ScanSearch className="w-3.5 h-3.5" aria-hidden />}
        {ship.ctxScanning ? 'Charting the codebase…' : 'Run context scan'}
      </button>
      {ship.ctxScanning && (
        <p className="typo-caption mt-2 text-foreground/40">Tracked in the activity dock — the library fills in when it completes.</p>
      )}
    </div>
  );
}

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
  const libraryThin = ship.features.length === 0 && ship.goals.length === 0;

  const toggle = (id: string) =>
    setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div data-testid="factory-ship-composer">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring rounded-interactive mb-3">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        Back to plan
      </button>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.25fr)' }}>
        {/* LEFT — the project library, grouped by context */}
        <div className="min-w-0 rounded-modal border border-foreground/[0.08] p-3" style={{ background: 'rgba(148,163,184,.02)' }}>
          {ship.contexts.length === 0 ? (
            <UnchartedEmptyState ship={ship} />
          ) : (
            <>
              <p className="typo-title mb-0.5">Project library</p>
              <p className="typo-caption mb-2.5">
                {libraryThin
                  ? 'The scan mapped these areas but no use cases exist yet — add the first ones right here, or run the feature scan from Overview.'
                  : 'What the scans mapped, grouped by area. Add use cases into the cut — their contexts follow automatically; goals bind as the objective.'}
              </p>
              <ul data-testid="ship-lib-tree">
                {ship.contexts.map((ctx) => {
                  const feats = ship.features.filter((f) => f.contexts.includes(ctx.name));
                  const goals = ship.goals.filter((g) => g.contexts.includes(ctx.name));
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
                          {feats.length === 0 && goals.length === 0 && 'empty'}
                          {inFp ? ' · in cut' : ''}
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
                          <QuickAddUseCase ctx={ctx} onAdd={(name) => ship.createFeature(ctx.id, name)} />
                        </motion.ul>
                      )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
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
            {/* Only point at the library when it can actually deliver. */}
            {vm.boundGoals.length === 0 && ship.goals.length > 0 && (
              <span className="typo-caption" style={{ color: INK.blue }}>No objective bound yet — bind a goal from the library.</span>
            )}
            {vm.boundGoals.length === 0 && ship.goals.length === 0 && (
              <span className="typo-caption text-foreground/40">No measurable goals defined for this project yet.</span>
            )}
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
                {ship.contexts.length === 0
                  ? 'The cut fills from the library — chart the codebase first.'
                  : 'Empty cut — add use cases from the library.'}
              </li>
            )}
          </LedgerList>
        </div>
      </div>
    </div>
  );
}
