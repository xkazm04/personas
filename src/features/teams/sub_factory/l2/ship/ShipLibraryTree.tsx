// The composer's library at 10–100-context scale — ContextLedger's patterns
// re-hosted on the Ship's local data: a search filter, colored GROUP BANDS
// (context groups) wrapping context rows, and per-context expansion revealing
// the features/goals to add. A context's NAME pops the detail drawer; the
// chevron expands its children in place. Every context carries a feature
// quick-add so a thin library never dead-ends.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Loader2, Plus, ScanSearch, Search, Sparkles, Target, Zap } from 'lucide-react';

import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { SCOPE_MAP_GLYPH } from '@/features/shared/glyph/glyphs/scopeMapGlyph';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { INK } from '../../passport/passportInk';
import { TONE_HUE_MAP, type ShipContext, type ShipGoal, type ShipMilestoneVM } from './shipModel';
import type { ShipData } from './useShipData';

const GROUP_HUES: Record<string, string> = {
  amber: '#F59E0B', teal: '#2DD4BF', violet: '#8B5CF6', blue: '#60A5FA',
  emerald: '#34D399', rose: '#FB7185', cyan: '#06B6D4', indigo: '#6366F1',
};
const groupHue = (c: string) => (c.startsWith('#') ? c : GROUP_HUES[c] ?? 'rgba(148,163,184,.6)');

const addBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

function QuickAddFeature({ ctx, onAdd, t, tx }: {
  ctx: ShipContext; onAdd: (name: string) => void;
  t: Translations; tx: (s: string, v: Record<string, string | number>) => string;
}) {
  const [name, setName] = useState('');
  const submit = () => { if (name.trim()) { onAdd(name.trim()); setName(''); } };
  return (
    <li className="flex items-center gap-1.5 py-1 pl-1 pr-1">
      <Plus className="w-3 h-3 shrink-0 text-foreground/35" aria-hidden />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={tx(t.ship.quickadd_placeholder, { name: ctx.name })}
        className="min-w-0 flex-1 rounded-input border border-foreground/[0.1] bg-transparent px-2 py-1 typo-caption text-foreground/90 placeholder:text-foreground/30 focus-ring"
        data-testid={`ship-quickadd-${ctx.id}`}
      />
      {name.trim() && <button type="button" onClick={submit} {...addBtn(INK.teal)}>{t.ship.add}</button>}
    </li>
  );
}

/** The unscanned-project empty state — the map is literally uncharted, and
 *  the ONE follow-up is charting it. */
function UnchartedEmptyState({ ship, t }: { ship: ShipData; t: Translations }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-8" data-testid="ship-lib-empty">
      <MotionizedGlyph data={SCOPE_MAP_GLYPH.data} viewBox={SCOPE_MAP_GLYPH.viewBox} className="w-36 h-36" glow />
      <p className="typo-title mt-3">{t.ship.uncharted_title}</p>
      <p className="typo-caption mt-1 max-w-xs">{t.ship.uncharted_hint}</p>
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
        {ship.ctxScanning ? t.ship.uncharted_scanning : t.ship.uncharted_scan}
      </button>
      {ship.ctxScanning && (
        <p className="typo-caption mt-2 text-foreground/40">{t.ship.uncharted_tracked}</p>
      )}
    </div>
  );
}

export function ShipLibraryTree({ ship, vm, onOpenContext, onNewGoal, onAssistGoal }: {
  ship: ShipData;
  vm: ShipMilestoneVM;
  /** Pop the context detail drawer. */
  onOpenContext: (ctx: ShipContext) => void;
  onNewGoal: () => void;
  /** Open the universal dispatch chooser with the goal-assist brief. */
  onAssistGoal: (goal: ShipGoal) => void;
}) {
  const { t, tx } = useTranslation();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(ship.groups.slice(0, 1).map((g) => g.id)));
  const [openCtx, setOpenCtx] = useState<Set<string>>(new Set());

  const coreIds = new Set(vm.members.filter((m) => m.bucket === 'core').map((m) => m.feature.id));
  const boundGoalIds = new Set(vm.boundGoals.map((g) => g.id));
  const libraryThin = ship.features.length === 0 && ship.goals.length === 0;

  // Group bands, filtered: a context survives if its own name, or any feature/
  // goal beneath it, matches. Filtering auto-opens everything that survives.
  const q = query.trim().toLowerCase();
  const bands = useMemo(() => {
    const byGroup = new Map<string | null, ShipContext[]>();
    for (const c of ship.contexts) {
      const key = c.groupId && ship.groups.some((g) => g.id === c.groupId) ? c.groupId : null;
      const list = byGroup.get(key);
      if (list) list.push(c);
      else byGroup.set(key, [c]);
    }
    const match = (c: ShipContext) => {
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      if (ship.features.some((f) => f.contexts.includes(c.name) && f.name.toLowerCase().includes(q))) return true;
      return ship.goals.some((g) => g.contexts.includes(c.name) && g.name.toLowerCase().includes(q));
    };
    const named = ship.groups.map((g) => ({
      id: g.id, name: g.name, hue: groupHue(g.color),
      contexts: (byGroup.get(g.id) ?? []).filter(match),
    }));
    const ungrouped = (byGroup.get(null) ?? []).filter(match);
    if (ungrouped.length > 0) named.push({ id: '__ungrouped', name: t.ship.ungrouped, hue: 'rgba(148,163,184,.6)', contexts: ungrouped });
    return named.filter((b) => b.contexts.length > 0);
  }, [ship.contexts, ship.groups, ship.features, ship.goals, q, t]);

  const toggle = (set: Set<string>, id: string, apply: (n: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    apply(n);
  };

  if (ship.contexts.length === 0) return <UnchartedEmptyState ship={ship} t={t} />;

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <p className="typo-title min-w-0">{t.ship.library_title}</p>
        <button
          type="button"
          onClick={onNewGoal}
          className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring"
          style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
          data-testid="ship-new-goal"
        >
          <Target className="w-3 h-3" aria-hidden />
          {t.ship.new_goal}
        </button>
      </div>
      <p className="typo-caption mb-2">
        {libraryThin ? t.ship.library_hint_thin : t.ship.library_hint}
      </p>
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.ship.filter_placeholder}
          className={`${INPUT_FIELD} !py-1 !pl-8 !text-sm`}
          aria-label={t.ship.filter_aria}
          data-testid="ship-lib-search"
        />
      </div>

      <ul data-testid="ship-lib-tree">
        {bands.map((band) => {
          const bandOpen = Boolean(q) || openGroups.has(band.id);
          return (
            <li key={band.id}>
              <button
                type="button"
                onClick={() => toggle(openGroups, band.id, setOpenGroups)}
                className="w-full flex items-center gap-2 px-1 py-1.5 rounded-interactive focus-ring bg-secondary/10 border-b border-foreground/[0.06] min-w-0"
                aria-expanded={bandOpen}
                data-testid={`ship-band-${band.id}`}
              >
                <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-foreground/40 transition-transform ${bandOpen ? 'rotate-90' : ''}`} aria-hidden />
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: band.hue }} />
                <span className="typo-title truncate">{band.name}</span>
                <span className="ml-auto typo-caption tabular-nums shrink-0">{band.contexts.length}</span>
              </button>
              {/* Level 2. Contexts used to sit at the SAME left edge as their
                  band, so the three levels read as two. Each level now steps in
                  and carries a hairline rail, so depth is legible without
                  reading the row. */}
              {bandOpen && <div className="ml-2 pl-2 border-l border-foreground/[0.09]">{band.contexts.map((ctx) => {
                const feats = ship.features.filter((f) => f.contexts.includes(ctx.name));
                const goals = ship.goals.filter((g) => g.contexts.includes(ctx.name));
                const isOpen = Boolean(q) || openCtx.has(ctx.id);
                const hue = TONE_HUE_MAP[ctx.tone];
                const inFp = vm.footprint.some((c) => c.id === ctx.id);
                return (
                  <div key={ctx.id} className="border-b border-foreground/[0.04] last:border-0">
                    <div className="flex items-center gap-2 py-1.5 px-1 min-w-0">
                      <button type="button" onClick={() => toggle(openCtx, ctx.id, setOpenCtx)} aria-expanded={isOpen} aria-label={tx(t.ship.expand_aria, { name: ctx.name })} className="shrink-0 focus-ring rounded-interactive">
                        <ChevronRight className={`w-3.5 h-3.5 text-foreground/40 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
                      </button>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hue }} />
                      <button
                        type="button"
                        onClick={() => onOpenContext(ctx)}
                        className="typo-body font-medium text-foreground/90 truncate text-left hover:text-primary transition-colors focus-ring rounded-interactive"
                        data-testid={`ship-tree-ctx-${ctx.id}`}
                      >
                        {ctx.name}
                      </button>
                      <span className="ml-auto typo-caption shrink-0">
                        {feats.length > 0 && `${feats.length}f`}{goals.length > 0 && ` ${goals.length}g`}
                        {feats.length === 0 && goals.length === 0 && t.ship.ctx_empty}
                        {inFp ? t.ship.ctx_in_cut : ''}
                      </span>
                    </div>
                    <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.ul
                        className="pb-1.5 overflow-hidden ml-2 pl-2 border-l border-foreground/[0.07]"
                        initial={reduce ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={reduce ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {feats.map((f) => {
                          const inCut = coreIds.has(f.id);
                          return (
                            <li key={f.id} className={`flex items-center gap-2 py-1 pl-1 pr-1 min-w-0 ${inCut ? 'opacity-45' : ''}`}>
                              <Sparkles className="w-3 h-3 shrink-0" style={{ color: INK.violet }} aria-hidden />
                              <span className="typo-caption text-foreground/85 min-w-0">{f.name}</span>
                              <span className="ml-auto">
                                {inCut
                                  ? <span className="typo-caption shrink-0">{t.ship.in_cut}</span>
                                  : (
                                    <button type="button" onClick={() => ship.setItem(vm.id, 'use_case', f.id, 'core')} {...addBtn(INK.teal)} aria-label={tx(t.ship.add_to_cut_aria, { name: f.name })}>
                                      <Plus className="w-3 h-3" aria-hidden />{t.ship.promote_cut}
                                    </button>
                                  )}
                              </span>
                            </li>
                          );
                        })}
                        {goals.map((g) => {
                          const bound = boundGoalIds.has(g.id);
                          return (
                            <li key={g.id} className={`flex items-center gap-2 py-1 pl-1 pr-1 min-w-0 ${bound ? 'opacity-45' : ''}`}>
                              <Target className="w-3 h-3 shrink-0" style={{ color: INK.teal }} aria-hidden />
                              <span className="typo-caption text-foreground/85 min-w-0">{g.name}</span>
                              <span className="ml-auto inline-flex items-center gap-1">
                                <button type="button" onClick={() => onAssistGoal(g)} className="p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring" title={t.ship.goal_assist_tooltip} aria-label={tx(t.ship.goal_assist_aria, { name: g.name })}>
                                  <Zap className="w-3 h-3" style={{ color: INK.violet }} aria-hidden />
                                </button>
                                {bound
                                  ? <span className="typo-caption shrink-0">{t.ship.bound}</span>
                                  : (
                                    <button type="button" onClick={() => ship.setItem(vm.id, 'goal', g.id, 'core')} {...addBtn(INK.teal)} aria-label={tx(t.ship.bind_aria, { name: g.name })}>
                                      <Plus className="w-3 h-3" aria-hidden />{t.ship.bind}
                                    </button>
                                  )}
                              </span>
                            </li>
                          );
                        })}
                        <QuickAddFeature ctx={ctx} onAdd={(name) => ship.createFeature(ctx.id, name)} t={t} tx={tx} />
                      </motion.ul>
                    )}
                    </AnimatePresence>
                  </div>
                );
              })}</div>}
            </li>
          );
        })}
        {q && bands.length === 0 && (
          <li className="flex flex-col items-center gap-1.5 py-6 text-center">
            <Search className="w-5 h-5 text-foreground/30" aria-hidden />
            <p className="typo-caption">{tx(t.ship.no_matches, { query: query.trim() })}</p>
          </li>
        )}
      </ul>
    </>
  );
}
