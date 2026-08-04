// Context detail drawer — the ContextDetail (dev-tools Context Map) pattern
// re-hosted for the Ship composer: a right-side motion panel popping the full
// record of one context. Fed ONLY from ShipData (the Factory's local layer,
// never systemStore — the no-clobber rule). Actionable, not just readable:
// the features and goals listed here carry the same Cut / Bind affordances as
// the library tree, so the drawer is a selection surface at 100-context scale.
import { motion } from 'framer-motion';
import { AlertTriangle, File, Gauge, Plus, Sparkles, Target, X } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../passport/passportInk';
import { inContext } from './shipDerive';
import { TONE_HUE_MAP, type ShipContext, type ShipMilestoneVM } from './shipModel';
import type { ShipData } from './useShipData';

const addBtn = (hue: string) => ({
  className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0',
  style: { color: hue, borderColor: `${hue}55` },
} as const);

export function ShipContextDrawer({ ctx, groupName, vm, ship, onClose }: {
  ctx: ShipContext;
  groupName: string | null;
  vm: ShipMilestoneVM;
  ship: ShipData;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const hue = TONE_HUE_MAP[ctx.tone];
  // Resolve BY ID, never by display name (see shipDerive.inContext).
  const feats = inContext(ship.features, ctx.id);
  const goals = inContext(ship.goals, ctx.id);
  const coreIds = new Set(vm.members.filter((m) => m.bucket === 'core').map((m) => m.feature.id));
  const boundGoalIds = new Set(vm.boundGoals.map((g) => g.id));

  return (
    <motion.aside
      className="fixed right-0 top-0 bottom-0 w-[380px] z-40 border-l border-foreground/[0.1] overflow-y-auto shadow-elevation-4"
      style={{ background: 'color-mix(in srgb, var(--background) 94%, #1e293b)' }}
      initial={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
      animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      aria-label={tx(t.ship.drawer_aria, { name: ctx.name })}
      data-testid="ship-context-drawer"
    >
      <div className="p-4">
        {/* header */}
        <div className="flex items-center gap-2 mb-1 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 6px ${hue}77` }} />
          <h3 className="typo-title-lg truncate">{ctx.name}</h3>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/[0.08] transition-colors focus-ring">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        {groupName && <p className="typo-caption mb-3">{groupName}</p>}

        {/* the health record */}
        <div className="flex items-center gap-4 rounded-card border border-foreground/[0.08] px-3 py-2 mb-4" style={{ background: 'rgba(148,163,184,.03)' }}>
          <span className="inline-flex items-center gap-1.5 typo-caption tabular-nums"><File className="w-3.5 h-3.5 text-foreground/45" aria-hidden />{tx(t.ship.drawer_files_count, { count: ctx.files.length })}</span>
          <span className="inline-flex items-center gap-1.5 typo-caption tabular-nums" style={{ color: ctx.kpis === 0 ? INK.blue : INK.emerald }}>
            <Gauge className="w-3.5 h-3.5" aria-hidden />{ctx.kpis === 0
              ? t.ship.no_kpi_short
              : tx(ctx.kpis === 1 ? t.ship.kpi_count_one : t.ship.kpi_count_other, { count: ctx.kpis })}
          </span>
          {ctx.errors !== null && (
            <span className="inline-flex items-center gap-1.5 typo-caption tabular-nums" style={{ color: ctx.errors >= 25 ? INK.red : ctx.errors > 0 ? INK.amber : INK.emerald }}>
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden />{tx(t.ship.drawer_errors_count, { count: ctx.errors })}
            </span>
          )}
        </div>

        {/* features slicing this context — same affordances as the tree */}
        <p className="typo-title mb-1.5">{t.ship.drawer_features} <span className="typo-data text-foreground/40">{feats.length}</span></p>
        <ul className="mb-4">
          {feats.map((f) => {
            const inCut = coreIds.has(f.id);
            return (
              <li key={f.id} className={`flex items-center gap-2 py-1.5 border-b border-foreground/[0.05] last:border-0 min-w-0 ${inCut ? 'opacity-45' : ''}`}>
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
          {feats.length === 0 && <li className="typo-caption py-1.5">{t.ship.drawer_features_empty}</li>}
        </ul>

        {/* goals attached here */}
        <p className="typo-title mb-1.5">{t.ship.drawer_goals} <span className="typo-data text-foreground/40">{goals.length}</span></p>
        <ul className="mb-4">
          {goals.map((g) => {
            const bound = boundGoalIds.has(g.id);
            return (
              <li key={g.id} className={`flex items-center gap-2 py-1.5 border-b border-foreground/[0.05] last:border-0 min-w-0 ${bound ? 'opacity-45' : ''}`}>
                <Target className="w-3 h-3 shrink-0" style={{ color: INK.teal }} aria-hidden />
                <span className="typo-caption text-foreground/85 min-w-0">{g.name}</span>
                <span className="ml-auto">
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
          {goals.length === 0 && <li className="typo-caption py-1.5">{t.ship.drawer_goals_empty}</li>}
        </ul>

        {/* file sample — the "what actually lives here" record */}
        {ctx.files.length > 0 && (
          <>
            <p className="typo-title mb-1.5">{t.ship.drawer_files}</p>
            <ul className="rounded-card border border-foreground/[0.07] px-2.5 py-1.5" style={{ background: 'rgba(148,163,184,.02)' }}>
              {ctx.files.slice(0, 8).map((p) => (
                <li key={p} className="typo-code text-foreground/60 truncate py-0.5">{p}</li>
              ))}
              {ctx.files.length > 8 && <li className="typo-caption py-0.5">{tx(t.ship.drawer_files_more, { count: ctx.files.length - 8 })}</li>}
            </ul>
          </>
        )}
      </div>
    </motion.aside>
  );
}
