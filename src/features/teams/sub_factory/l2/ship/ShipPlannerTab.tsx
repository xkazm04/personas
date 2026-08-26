// The Ship surface (wired): Planner split-pane over LIVE dev_milestones —
// vertical roadmap spine left, milestone workspace right, one ledger language
// for the whole scope. Buckets/creep/status are real rows; progress, footprint
// and exit criteria derive in useShipData from the signals the Factory already
// trusts. Composition opens per milestone (ShipMilestoneComposer).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Check, Plus, Rocket, Sparkles, Telescope } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAskAthena } from '@/features/plugins/companion/useAskAthena';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import { INK } from '../../passport/passportInk';
import type { FactoryL2Data } from '../factoryL2Data';
import { buildShipAskPrompt, buildShipDecomposePrompt } from './shipAthena';
import { publishShipReadiness } from './shipReadinessPublish';
import { ShipCertifyModal } from './ShipCertifyModal';
import { ShipCriteriaList } from './ShipCriteriaPanel';
import { ShipControlBar } from './ShipControlBar';
import { ShipItemAnnotations } from './ShipItemAnnotations';
import { goalStatusLabel, goalStatusMeta } from '@/features/teams/sub_goals/goalStatus';
import { ShipMilestoneComposer } from './ShipMilestoneComposer';
import { ShipRunSummary, useShipMilestoneRun } from './ShipMilestoneRun';
import { ShipDescriptionField, ShipDualitySummary, ShipGoalField } from './ShipMilestoneMeta';
import {
  BUCKET_HUE, bucketLabel,
  type ScopeBucket, type ShipMilestoneVM,
} from './shipModel';
import { deriveCutTally } from './shipDerive';
import { LedgerEmpty, LedgerHeader, LedgerList, LedgerObjectiveHeader, LedgerRow } from './shipRows';
import { ShipVelocityNote } from './ShipVelocityNote';
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

/** One row of the outside-the-cut pool, whichever kind it is. `status` is
 *  present only on goals — a feature's standing is the automation's readiness
 *  verdict and is shown in the cut, not here. */
interface PoolRow {
  kind: 'use_case' | 'goal';
  id: string;
  name: string;
  contexts: string[];
  bucket: ScopeBucket | null;
  afterCut: boolean;
  status?: string;
}

function Workspace({ vm, ship, editable, t, tx }: {
  vm: ShipMilestoneVM; ship: ShipData; editable: boolean;
  t: Translations; tx: (s: string, v: Record<string, string | number>) => string;
}) {
  const memberIds = new Set(vm.members.map((mm) => mm.feature.id));
  const goalMemberIds = new Set(vm.goalMembers.map((gm) => gm.goal.id));
  const core = vm.members.filter((mm) => mm.bucket === 'core');
  // THE POOL IS BOTH KINDS.
  //
  // It used to list features alone, so a project's goals were reachable only
  // through the composer's rail — a surface you open to EDIT scope, not the one
  // you read it on. A project with goals and no use cases (which is every
  // project whose brief has just been decomposed, and several that will never
  // have use cases at all) showed an empty ledger and the words "No features
  // mapped yet", which is both the wrong vocabulary and a dead end.
  const outside: PoolRow[] = [
    ...vm.members.filter((mm) => mm.bucket !== 'core').map((mm) => ({
      kind: 'use_case' as const,
      id: mm.feature.id,
      name: mm.feature.name,
      contexts: mm.feature.contexts,
      bucket: mm.bucket as ScopeBucket | null,
      afterCut: mm.afterCut,
    })),
    ...ship.features.filter((f) => !memberIds.has(f.id)).map((f) => ({
      kind: 'use_case' as const,
      id: f.id,
      name: f.name,
      contexts: f.contexts,
      bucket: null,
      afterCut: false,
    })),
    ...vm.goalMembers.filter((gm) => gm.bucket !== 'core').map((gm) => ({
      kind: 'goal' as const,
      id: gm.goal.id,
      name: gm.goal.name,
      contexts: gm.goal.contexts,
      bucket: gm.bucket as ScopeBucket | null,
      afterCut: gm.afterCut,
      status: gm.goal.status,
    })),
    ...ship.goals.filter((g) => !goalMemberIds.has(g.id)).map((g) => ({
      kind: 'goal' as const,
      id: g.id,
      name: g.name,
      contexts: g.contexts,
      bucket: null,
      afterCut: false,
      status: g.status,
    })),
  ];
  // The cut is BOTH kinds. It used to render `members` alone — features — so a
  // milestone whose whole cut was goals showed an empty ledger and a 0/0 count
  // while carrying real, tracked work. Goals were visible only in the composer's
  // rail, which is a place you go to EDIT scope, not the place you read it.
  const coreGoals = vm.goalMembers.filter((gm) => gm.bucket === 'core');
  // ONE derivation for the fraction and the percentage — see `deriveCutTally`
  // for the disagreement that made it a shared function.
  const { done: coreReady, total: cutSize } = deriveCutTally(core, coreGoals.map((gm) => gm.goal));
  // An empty ledger is not worth a panel: a header, a count of zero and a card
  // saying nothing is there costs more attention than it returns. Each side
  // hides when it holds nothing. The one exception is a milestone with NOTHING
  // on either side, where hiding both would leave a workspace with no way
  // forward: there, the cut keeps its empty state as the single call to action.
  const showCut = cutSize > 0 || outside.length === 0;
  const showOutside = outside.length > 0;

  return (
    <>
      {/* The milestone IS its objective, so the objective heads the cut rather
          than floating in the page header two readings away from the ledger it
          describes. Rendered unconditionally — `showCut` hides the LIST when
          there is nothing in the cut and everything is still outside it, and a
          milestone with no identity on screen at that exact moment is worse
          than an empty list. */}
      <LedgerObjectiveHeader
        count={tx(t.ship.in_the_cut_count, { done: coreReady, total: cutSize })}
        objective={(
          <ShipGoalField
            name={vm.name}
            goal={vm.goal}
            editable={editable}
            onSave={(goal) => ship.setGoal(vm.id, goal)}
          />
        )}
        description={(
          <ShipDescriptionField
            name={vm.name}
            description={vm.description}
            editable={editable}
            onSave={(description) => ship.setDescription(vm.id, description)}
          />
        )}
      />

      {showCut && (
      <>
      <div className="mb-5">
        <LedgerList testid="ship-cut-list">
          {core.map((mm, i) => (
            <LedgerRow
              key={mm.feature.id}
              index={i}
              name={mm.feature.name}
              contexts={mm.feature.contexts}
              // the AUTOMATION's reading, on the row's right edge …
              stateLabel={mm.feature.stateLabel}
              stateHue={mm.feature.stateHue}
              blocker={mm.feature.blocker}
              meta={mm.afterCut ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span> : undefined}
              // … and the OPERATOR's, in its own strip underneath. Two readings,
              // two places, never merged into one score.
              footer={(
                <ShipItemAnnotations
                  kind="use_case"
                  id={mm.feature.id}
                  name={mm.feature.name}
                  ready={mm.feature.ready}
                  description={mm.description}
                  rating={mm.rating}
                  editable={editable}
                  onPatch={(patch) => ship.setItem(vm.id, 'use_case', mm.feature.id, mm.bucket, patch)}
                />
              )}
              actions={editable && (
                <>
                  {(['later', 'never'] as const).map((b) => (
                    <BucketBtn key={b} label={bucketLabel(t, b)} onClick={() => ship.setItem(vm.id, 'use_case', mm.feature.id, b)} />
                  ))}
                </>
              )}
            />
          ))}
          {coreGoals.map((gm, i) => {
            const meta = goalStatusMeta(gm.goal.status);
            return (
              <LedgerRow
                key={gm.goal.id}
                index={core.length + i}
                name={gm.goal.name}
                contexts={gm.goal.contexts}
                // A goal's right edge carries its STATUS, not a readiness verdict.
                // Readiness is derived from KPI coverage and context health; a goal
                // has neither, and rendering a green "Ready" next to one would be
                // an automation reading nobody took.
                stateLabel={goalStatusLabel(t.plugins.dev_lifecycle, gm.goal.status)}
                stateHue={meta.map.fill}
                blocker={null}
                meta={(
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="typo-caption" style={{ color: INK.teal }}>{t.ship.member_kind_goal}</span>
                    {gm.afterCut && (
                      <span className="typo-caption" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span>
                    )}
                  </span>
                )}
                footer={(
                  <ShipItemAnnotations
                    kind="goal"
                    id={gm.goal.id}
                    name={gm.goal.name}
                    ready={null}
                    description={gm.description}
                    rating={gm.rating}
                    editable={editable}
                    onPatch={(patch) => ship.setItem(vm.id, 'goal', gm.goal.id, gm.bucket, patch)}
                  />
                )}
                actions={editable && (
                  <>
                    {(['later', 'never'] as const).map((b) => (
                      <BucketBtn key={b} label={bucketLabel(t, b)} onClick={() => ship.setItem(vm.id, 'goal', gm.goal.id, b)} />
                    ))}
                  </>
                )}
              />
            );
          })}
          {cutSize === 0 && (
            <LedgerEmpty testid="ship-cut-empty">
              {/* Three different situations, and the old copy collapsed them
                  into one sentence about features. A project with goals and no
                  use cases was told "No features mapped yet", which is true,
                  useless, and points at the wrong door. */}
              {outside.length > 0
                ? t.ship.cut_empty_planner
                : vm.description
                  ? t.ship.cut_empty_has_brief
                  : t.ship.cut_empty_nothing}
            </LedgerEmpty>
          )}
        </LedgerList>
      </div>
      </>
      )}

      {/* The exit criteria, beside the cut they are measured against. They lived
          behind the certify dialog, which made the only complete reading of a
          milestone reachable through the button that also commits it. */}
      <div className="mb-5">
        <LedgerHeader title={t.ship.exit_criteria} count={vm.criteria.filter((c) => c.state === 'go').length} aside={t.ship.exit_criteria_aside} muted />
        <ShipCriteriaList vm={vm} project={ship.project} />
      </div>

      {showOutside && (
      <>
      <LedgerHeader title={t.ship.outside_the_cut} count={outside.length} aside={t.ship.outside_the_cut_aside} muted />
      <LedgerList testid="ship-outside-list">
        {outside.map((row, i) => (
          <LedgerRow
            key={`${row.kind}:${row.id}`}
            index={i}
            name={row.name}
            contexts={row.contexts}
            dim={row.bucket === 'never'}
            marker={row.afterCut ? <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden /> : undefined}
            meta={(
              <span className="flex items-center gap-1.5 shrink-0">
                {/* Which KIND this is, always — the pool mixes them now, and a
                    goal beside a feature with no marking is unreadable. */}
                {row.kind === 'goal' && (
                  <span className="typo-caption" style={{ color: INK.teal }}>{t.ship.member_kind_goal}</span>
                )}
                {row.kind === 'goal' && row.status && (
                  <span className="typo-caption" style={{ color: goalStatusMeta(row.status).map.fill }}>
                    {goalStatusLabel(t.plugins.dev_lifecycle, row.status)}
                  </span>
                )}
                {row.afterCut
                  ? <span className="typo-caption" style={{ color: INK.violet }}>{t.ship.added_after_cut}</span>
                  : row.bucket === null
                    ? <span className="typo-caption text-foreground/35">{t.ship.unassigned}</span>
                    : null}
              </span>
            )}
            actions={editable && (
              <>
                <Tooltip content={t.ship.promote_cut_tooltip}>
                  <button
                    type="button"
                    onClick={() => ship.setItem(vm.id, row.kind, row.id, 'core')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring"
                    style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
                  >
                    <ArrowUp className="w-3 h-3" aria-hidden />
                    {t.ship.promote_cut}
                  </button>
                </Tooltip>
                {(['later', 'never'] as const).map((b) => (
                  <BucketBtn key={b} label={bucketLabel(t, b)} on={row.bucket === b} hue={BUCKET_HUE[b]}
                    onClick={() => ship.setItem(vm.id, row.kind, row.id, b)} />
                ))}
              </>
            )}
          />
        ))}
      </LedgerList>
      </>
      )}
    </>
  );
}

export function ShipPlannerTab({ data }: { data: FactoryL2Data }) {
  const { t, tx } = useTranslation();
  const reduce = useReducedMotion();
  const ship = useShipData(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [certifying, setCertifying] = useState(false);
  const select = (id: string) => { setSelectedId(id); setComposing(false); };
  const askAthena = useAskAthena();

  // Resolved BEFORE the early returns so the run hook below keeps a stable
  // position in hook order — `ship.roadmap` is simply empty while loading.
  const vm = ship.roadmap.find((x) => x.id === selectedId)
    ?? ship.roadmap.find((x) => x.status === 'active')
    ?? ship.roadmap[0];

  const runner = useShipMilestoneRun(vm?.id ?? '', data.project?.root_path ?? null);

  // Publish what this tab DERIVED so `describe_ship_milestone` can serve it.
  // The exit criteria and the ship verdict are computed here from signals
  // SQLite cannot reproduce (per-context Sentry counts, bound credentials), and
  // until this existed the only way to get them to Athena was to paste them
  // into the Ask-Athena message — which handed her a conclusion before she had
  // read anything. Debounced and deduped in the publisher, so an unchanged
  // roadmap costs no IPC. Runs on the whole roadmap, not the selected
  // milestone: switching selection must not narrow what she can answer about.
  useEffect(() => {
    publishShipReadiness(ship.roadmap);
  }, [ship.roadmap]);

  if (ship.loading) {
    return <div className="flex justify-center py-10" data-testid="factory-ship-loading"><LoadingSpinner size="md" /></div>;
  }

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

  // Point her at the milestone and the op that reads it. Do not paste the
  // milestone, do not paste the verdict, and do not tell her what to say — see
  // shipAthena.ts for what each of those cost.
  const openAthena = () => {
    if (!data.project) return;
    askAthena('Ship', buildShipAskPrompt(vm, data.project));
  };

  // Decompose goes through the SAME channel as Ask Athena — deliberately.
  // There is no second LLM path here: the brief is read by the read op and the
  // goals come back as a `show_ship_goals` card, so everything this button
  // does is ask her to do two things she can already do.
  const decomposeBrief = () => {
    if (!data.project) return;
    askAthena('Ship', buildShipDecomposePrompt(vm, data.project));
  };

  return (
    <div data-testid="factory-ship-planner">
      {/* full-width content header — objective, readings, and the control bar */}
      <motion.div
        key={`hdr:${vm.id}`}
        className="flex items-start gap-3 mb-4"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        data-testid="ship-content-header"
      >
        <div className="min-w-0 flex-1">
          {/* Objective + description moved into the cut header (Workspace) —
              the milestone's identity belongs on the thing it names. What is
              left here is the two readings that are ABOUT the milestone rather
              than part of it, and the controls. */}
          <ShipVelocityNote rows={ship.roadmap.map((ms) => ms.row)} vm={vm} />
          {/* Reporting only: certification is gated by `verdict` (the criteria
              registry, now read inside the certify panel), never by these. */}
          <ShipDualitySummary duality={vm.duality} />

          <div className="mt-3">
            <ShipControlBar
              vm={vm}
              project={data.project}
              editable={editable}
              onCertify={() => setCertifying(true)}
              onCompose={() => setComposing(true)}
              onAskAthena={openAthena}
              onDecompose={decomposeBrief}
              onRun={runner.run}
              onIngest={runner.ingest}
              running={runner.spawning}
              ingesting={runner.ingesting}
            />
            {runner.summary && (
              <ShipRunSummary summary={runner.summary} onDismiss={runner.dismissSummary} />
            )}
          </div>
        </div>
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

      {certifying && (
        <ShipCertifyModal
          vm={vm}
          onCertify={() => ship.setStatus(vm.id, vm.status === 'planned' ? 'active' : 'shipped')}
          onClose={() => setCertifying(false)}
        />
      )}
    </div>
  );
}
