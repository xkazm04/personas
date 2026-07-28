// The Ship surface (wired): Planner split-pane over LIVE dev_milestones —
// vertical roadmap spine left, milestone workspace right, one ledger language
// for the whole scope. Buckets/creep/status are real rows; progress, footprint
// and exit criteria derive in useShipData from the signals the Factory already
// trusts. Composition opens per milestone (ShipMilestoneComposer).
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Check, PencilRuler, Plus, Rocket, Sparkles, SquareTerminal, Telescope, Zap } from 'lucide-react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import {
  PASSPORT_FLEET_INK, PassportTerminalModal, usePassportFleetSessions,
} from '../../passport/passportFleet';
import { INK } from '../../passport/passportInk';
import type { FactoryL2Data } from '../factoryL2Data';
import { buildCriterionPrompt, ShipDispatchModal, shipDispatchKey } from './ShipDispatch';
import { ShipMilestoneComposer } from './ShipMilestoneComposer';
import {
  BUCKET_HUE, CRIT_HUE, bucketLabel, shipVerdict,
  type ExitCriterion, type ScopeBucket, type ShipMilestoneVM,
} from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';
import { useShipData, type ShipData } from './useShipData';

const STATUS_META: Record<ShipMilestoneVM['status'], { hue: string; icon: typeof Check }> = {
  shipped: { hue: INK.emerald, icon: Check },
  active: { hue: INK.teal, icon: Rocket },
  planned: { hue: 'rgba(148,163,184,.6)', icon: Telescope },
};

function TimelineCard({ vm, selected, onSelect, index, reduce }: {
  vm: ShipMilestoneVM; selected: boolean; onSelect: () => void; index: number; reduce: boolean | null;
}) {
  const { hue, icon: Icon } = STATUS_META[vm.status];
  return (
    <motion.li
      className="relative pl-7"
      initial={reduce ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.09, duration: 0.3 }}
    >
      <span className="absolute left-[5px] top-4 w-3 h-3 rounded-full flex items-center justify-center"
        style={vm.status === 'shipped' ? { background: hue } : { border: `1.5px ${vm.status === 'planned' ? 'dashed' : 'solid'} ${hue}`, background: 'var(--background)' }} />
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left rounded-card px-3 py-2.5 mb-2.5 transition-shadow focus-ring"
        style={{
          border: `1px solid ${selected ? `${hue}88` : 'rgba(148,163,184,.14)'}`,
          background: selected ? `color-mix(in srgb, ${hue} 6%, transparent)` : 'rgba(148,163,184,.03)',
          boxShadow: selected ? `0 4px 20px -8px ${hue}55` : undefined,
        }}
        aria-pressed={selected}
        data-testid={`ship-planner-node-${vm.id}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: hue }} aria-hidden />
          <span className="typo-title truncate">{vm.name}</span>
        </span>
        <span className="flex items-center gap-2 mt-1.5">
          <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,.12)' }}>
            <span className="block h-full rounded-full" style={{ width: `${vm.progress}%`, background: hue }} />
          </span>
          <span className="typo-data shrink-0" style={{ color: hue }}>{vm.status === 'planned' && vm.members.length === 0 ? '—' : `${vm.progress}%`}</span>
        </span>
        {vm.targetLabel && <span className="typo-caption block mt-1">{vm.targetLabel}</span>}
      </button>
    </motion.li>
  );
}

function NewMilestoneForm({ onCreate, prominent, t }: { onCreate: (name: string) => void; prominent?: boolean; t: Translations }) {
  const [name, setName] = useState('');
  const submit = () => { if (name.trim()) { onCreate(name.trim()); setName(''); } };
  return (
    <div className={`flex items-center gap-1.5 ${prominent ? '' : 'pl-7'}`}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={t.ship.new_milestone_placeholder}
        className="min-w-0 flex-1 rounded-input border border-foreground/[0.12] bg-transparent px-2.5 py-1.5 typo-caption text-foreground/90 placeholder:text-foreground/35 focus-ring"
        data-testid="ship-new-milestone-name"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim()}
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring disabled:opacity-40"
        style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
        data-testid="ship-new-milestone-create"
      >
        <Plus className="w-3 h-3" aria-hidden />
        {t.ship.add}
      </button>
    </div>
  );
}

function BucketBtn({ label, on, onClick, hue }: { label: string; on?: boolean; onClick: () => void; hue?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-interactive typo-caption border transition-colors focus-ring ${on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/80'}`}
      style={{ borderColor: on && hue ? hue : 'rgba(148,163,184,.16)' }}
    >
      {label}
    </button>
  );
}

function Workspace({ vm, ship, editable, t, tx }: {
  vm: ShipMilestoneVM; ship: ShipData; editable: boolean;
  t: Translations; tx: (s: string, v: Record<string, string | number>) => string;
}) {
  const memberIds = new Set(vm.members.map((mm) => mm.feature.id));
  const core = vm.members.filter((mm) => mm.bucket === 'core');
  const outside = [
    ...vm.members.filter((mm) => mm.bucket !== 'core').map((mm) => ({ f: mm.feature, bucket: mm.bucket as ScopeBucket | null, afterCut: mm.afterCut })),
    ...ship.features.filter((f) => !memberIds.has(f.id)).map((f) => ({ f, bucket: null, afterCut: false })),
  ];
  const coreReady = core.filter((mm) => mm.feature.ready).length;

  return (
    <>
      <LedgerHeader
        title={t.ship.in_the_cut}
        count={tx(t.ship.in_the_cut_count, { done: coreReady, total: core.length })}
        aside={tx(t.ship.in_the_cut_aside, { name: vm.name })}
      />
      <div className="mb-5">
        <LedgerList testid="ship-cut-list">
          {core.map((mm, i) => (
            <LedgerRow
              key={mm.feature.id}
              index={i}
              name={mm.feature.name}
              contexts={mm.feature.contexts}
              stateLabel={mm.feature.stateLabel}
              stateHue={mm.feature.stateHue}
              blocker={mm.feature.blocker}
              meta={mm.afterCut ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span> : undefined}
              actions={editable && (
                <>
                  {(['later', 'never'] as const).map((b) => (
                    <BucketBtn key={b} label={bucketLabel(t, b)} onClick={() => ship.setItem(vm.id, 'use_case', mm.feature.id, b)} />
                  ))}
                </>
              )}
            />
          ))}
          {core.length === 0 && (
            <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
              {t.ship.cut_empty_planner}
            </li>
          )}
        </LedgerList>
      </div>

      <LedgerHeader title={t.ship.outside_the_cut} count={outside.length} aside={t.ship.outside_the_cut_aside} muted />
      <LedgerList testid="ship-outside-list">
        {outside.map(({ f, bucket, afterCut }, i) => (
          <LedgerRow
            key={f.id}
            index={i}
            name={f.name}
            contexts={f.contexts}
            dim={bucket === 'never'}
            marker={afterCut ? <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden /> : undefined}
            meta={afterCut
              ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span>
              : bucket === null
                ? <span className="typo-caption shrink-0 text-foreground/35">{t.ship.unassigned}</span>
                : undefined}
            actions={editable && (
              <>
                <button
                  type="button"
                  onClick={() => ship.setItem(vm.id, 'use_case', f.id, 'core')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring"
                  style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
                  title={t.ship.promote_cut_tooltip}
                >
                  <ArrowUp className="w-3 h-3" aria-hidden />
                  {t.ship.promote_cut}
                </button>
                {(['later', 'never'] as const).map((b) => (
                  <BucketBtn key={b} label={bucketLabel(t, b)} on={bucket === b} hue={BUCKET_HUE[b]}
                    onClick={() => ship.setItem(vm.id, 'use_case', f.id, b)} />
                ))}
              </>
            )}
          />
        ))}
        {outside.length === 0 && (
          <li className="typo-caption px-3.5 py-2.5">
            {ship.features.length === 0 ? t.ship.outside_empty_no_features : t.ship.outside_empty_all_in}
          </li>
        )}
      </LedgerList>
    </>
  );
}

export function ShipPlannerTab({ data }: { data: FactoryL2Data }) {
  const { t, tx } = useTranslation();
  const reduce = useReducedMotion();
  const ship = useShipData(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const select = (id: string) => { setSelectedId(id); setComposing(false); };
  // Criterion resolution — Fleet dispatch through the passport wall's machinery.
  const fleetSessions = usePassportFleetSessions();
  const [dispatchCrit, setDispatchCrit] = useState<ExitCriterion | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);

  if (ship.loading) {
    return <div className="flex justify-center py-10" data-testid="factory-ship-loading"><LoadingSpinner size="md" /></div>;
  }

  const vm = ship.roadmap.find((x) => x.id === selectedId)
    ?? ship.roadmap.find((x) => x.status === 'active')
    ?? ship.roadmap[0];

  if (!vm) {
    return (
      <div className="max-w-md mx-auto py-10 text-center" data-testid="factory-ship-empty">
        <p className="typo-title-lg mb-1">{t.ship.empty_title}</p>
        <p className="typo-caption mb-4">{t.ship.empty_hint}</p>
        <NewMilestoneForm onCreate={(name) => ship.create(name)} prominent t={t} />
      </div>
    );
  }

  const editable = vm.status !== 'shipped';
  const verdict = shipVerdict(vm.criteria);

  return (
    <div data-testid="factory-ship-planner">
      {/* full-width content header — goal, criteria tags, lifecycle + compose */}
      <motion.div
        key={`hdr:${vm.id}`}
        className="flex items-start gap-3 mb-4"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        data-testid="ship-content-header"
      >
        <div className="min-w-0">
          <p className="typo-title-lg">{vm.goal ?? vm.name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {vm.criteria.map((c) => {
              const key = data.project ? shipDispatchKey(c.id, data.project.id) : null;
              const session = key ? fleetSessions.get(key) : undefined;
              const dispatchable = c.state !== 'go' && data.project && buildCriterionPrompt(vm, c, data.project) !== null;
              return (
                <span key={c.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption tabular-nums" style={{ borderColor: `${CRIT_HUE[c.state]}55`, color: CRIT_HUE[c.state] }} title={c.evidence}>
                  {c.label} {c.done}/{c.total}
                  {session && key ? (
                    <button
                      type="button"
                      onClick={() => setTerminalKey(key)}
                      aria-label={tx(t.ship.session_open_aria, { label: c.label })}
                      title={tx(t.ship.session_open_tooltip, { state: String(session.state).replace('_', ' ') })}
                      className="p-0.5 -mr-1 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
                    >
                      <SquareTerminal className="w-3.5 h-3.5" style={{ color: PASSPORT_FLEET_INK[String(session.state)] ?? 'rgba(148,163,184,.6)' }} aria-hidden />
                    </button>
                  ) : dispatchable ? (
                    <button
                      type="button"
                      onClick={() => setDispatchCrit(c)}
                      aria-label={tx(t.ship.dispatch_gap_aria, { label: c.label })}
                      title={t.ship.dispatch_gap_tooltip}
                      className="p-0.5 -mr-1 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
                      data-testid={`ship-dispatch-${c.id}`}
                    >
                      <Zap className="w-3.5 h-3.5" style={{ color: INK.violet }} aria-hidden />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
        {editable && !composing && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => ship.setStatus(vm.id, vm.status === 'planned' ? 'active' : 'shipped')}
              disabled={vm.status === 'active' && verdict !== 'go'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring disabled:opacity-40"
              style={{ color: INK.emerald, borderColor: `${INK.emerald}55` }}
              title={vm.status === 'planned'
                ? t.ship.certify_cut_tooltip
                : verdict === 'go' ? t.ship.certify_ship_tooltip : t.ship.certify_blocked_tooltip}
              data-testid="ship-lifecycle-action"
            >
              <Rocket className="w-3.5 h-3.5" aria-hidden />
              {vm.status === 'planned' ? t.ship.certify_cut : t.ship.certify_ship}
            </button>
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring"
              style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
              data-testid="ship-compose-open"
            >
              <PencilRuler className="w-3.5 h-3.5" aria-hidden />
              {t.ship.compose_scope}
            </button>
          </span>
        )}
      </motion.div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(230px, 270px) minmax(0, 1fr)' }}>
        {/* the roadmap spine */}
        <div className="relative">
          <span className="absolute left-[10px] top-5 bottom-5 w-px" style={{ background: `linear-gradient(${INK.emerald}66, ${INK.teal}66, rgba(148,163,184,.2))` }} aria-hidden />
          <ul>
            {ship.roadmap.map((ms, i) => (
              <TimelineCard key={ms.id} vm={ms} selected={ms.id === vm.id} onSelect={() => select(ms.id)} index={i} reduce={reduce} />
            ))}
          </ul>
          <NewMilestoneForm onCreate={(name) => ship.create(name)} t={t} />
        </div>

        {/* the workspace — fades between the scope ledgers and the composer */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${vm.id}:${composing}`}
            className="min-w-0"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {composing ? (
              <ShipMilestoneComposer vm={vm} ship={ship} onBack={() => setComposing(false)} />
            ) : (
              <Workspace vm={vm} ship={ship} editable={editable} t={t} tx={tx} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {dispatchCrit && data.project && (
        <ShipDispatchModal
          vm={vm}
          criterion={dispatchCrit}
          project={data.project}
          onDispatched={(key) => { setDispatchCrit(null); setTerminalKey(key); }}
          onClose={() => setDispatchCrit(null)}
        />
      )}
      {terminalKey && (
        <PassportTerminalModal
          sessionId={fleetSessions.get(terminalKey)?.id ?? ''}
          session={fleetSessions.get(terminalKey) ?? null}
          onClose={() => setTerminalKey(null)}
        />
      )}
    </div>
  );
}
