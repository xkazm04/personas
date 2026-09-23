// The cut, rehosted for ONE milestone.
//
// This is the retired `ShipPlannerTab`'s `Workspace` (`:138-399` as it stood at
// its deletion on 2026-09-15) with one thing removed and nothing added: the
// roadmap. The Ship tab showed every milestone of a project and needed a spine
// to pick between them; a NOTE is the brief of exactly one, so the selector has
// no question to answer here and the ledger is the whole surface.
//
// The objective is the other difference. In the Ship tab it headed the cut
// (`LedgerObjectiveHeader`), because the cut is the first thing on the page. In
// the pad it sits in the pane's header strip above the tabs, where it stays
// readable from Criteria and Runs as well — so this file renders the COUNT
// header and never the objective, and the two never appear twice.
import { ArrowUp, Sparkles } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { Translations } from '@/i18n/generated/types';
import { goalStatusLabel, goalStatusMeta } from '@/features/teams/sub_goals/goalStatus';
import { deriveCutTally } from '@/lib/milestone/shipDerive';
import {
  bucketLabel,
  type ScopeBucket, type ShipMilestoneVM,
} from '@/lib/milestone/shipModel';

import { PLAN_BORDER, PLAN_INK } from './planInk';
import { ShipItemAnnotations } from './ShipItemAnnotations';
import { AfterCutMark, KindMark, LedgerEmpty, LedgerHeader, LedgerList, LedgerRow } from './shipRows';
import type { ShipData } from './useProjectPlan';

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

/** Later / Never. The SELECTED one takes the bucket's own border; the rest sit
 *  on structural grey. A role rather than a colour — private to this file, so
 *  `BUCKET_HUE`'s hexes bought nothing a token cannot do. */
const BUCKET_BORDER: Record<ScopeBucket, string> = {
  core: PLAN_BORDER.accent,
  later: PLAN_BORDER.neutral,
  never: PLAN_BORDER.neutral,
};

function BucketBtn({ label, on, onClick, bucket }: {
  label: string;
  on?: boolean;
  onClick: () => void;
  /** Which bucket this button SETS — only read when `on`. */
  bucket?: ScopeBucket;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-interactive typo-caption border transition-colors focus-ring ${
        on ? 'text-foreground font-semibold' : 'text-foreground/60 hover:text-foreground/80'
      } ${on && bucket ? BUCKET_BORDER[bucket] : 'border-status-neutral/15'}`}
    >
      {label}
    </button>
  );
}

export function NotePlanLedger({ vm, ship, editable, t, tx }: {
  vm: ShipMilestoneVM;
  ship: ShipData;
  editable: boolean;
  t: Translations;
  tx: (s: string, v: Record<string, string | number>) => string;
}) {
  const memberIds = new Set(vm.members.map((mm) => mm.feature.id));
  const goalMemberIds = new Set(vm.goalMembers.map((gm) => gm.goal.id));
  const core = vm.members.filter((mm) => mm.bucket === 'core');

  // THE POOL IS BOTH KINDS — a project whose brief has just been decomposed has
  // goals and no use cases, and listing features alone showed it an empty
  // ledger and the words "No features mapped yet".
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

  const coreGoals = vm.goalMembers.filter((gm) => gm.bucket === 'core');
  // ONE derivation for the fraction and the percentage — see `deriveCutTally`
  // for the disagreement that made it a shared function.
  const { done: coreReady, total: cutSize } = deriveCutTally(core, coreGoals.map((gm) => gm.goal));
  // Each side hides when it holds nothing; a milestone with nothing on either
  // side keeps the cut's empty state as its single call to action.
  const showCut = cutSize > 0 || outside.length === 0;
  const showOutside = outside.length > 0;

  return (
    <div data-testid="note-plan-ledger">
      {showCut && (
        <div className="mb-5">
          <LedgerHeader
            title={t.notepad.plan_cut_title}
            count={tx(t.ship.in_the_cut_count, { done: coreReady, total: cutSize })}
          />
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
                meta={mm.afterCut ? <AfterCutMark label={t.ship.added_after_cut} /> : undefined}
                // … and the OPERATOR's, in its own strip underneath. Two
                // readings, two places, never merged into one score.
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
                  // A goal's right edge carries its STATUS, not a readiness
                  // verdict: readiness derives from KPI coverage and context
                  // health, and a goal has neither.
                  stateLabel={goalStatusLabel(t.plugins.dev_lifecycle, gm.goal.status)}
                  stateHue={meta.map.fill}
                  blocker={null}
                  meta={(
                    <>
                      <KindMark label={t.ship.member_kind_goal} />
                      {gm.afterCut && <AfterCutMark label={t.ship.added_after_cut} />}
                    </>
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
                {outside.length > 0
                  ? t.ship.cut_empty_planner
                  : vm.description
                    ? t.ship.cut_empty_has_brief
                    : t.notepad.plan_cut_empty_note}
              </LedgerEmpty>
            )}
          </LedgerList>
        </div>
      )}

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
                marker={row.afterCut ? <Sparkles className={`w-3.5 h-3.5 shrink-0 ${PLAN_INK.athena}`} aria-hidden /> : undefined}
                meta={(
                  <span className="flex items-center gap-1.5 shrink-0">
                    {/* Which KIND this is, always — the pool mixes them, and a
                        goal beside a feature with no marking is unreadable. */}
                    {row.kind === 'goal' && (
                      <span className={`typo-caption ${PLAN_INK.accent}`}>{t.ship.member_kind_goal}</span>
                    )}
                    {row.kind === 'goal' && row.status && (
                      // `tint`, not `map.fill`: the goal-status table carries
                      // BOTH, and the class half is the theme-aware one. The
                      // hex half exists for the force-graph canvas.
                      <span className={`typo-caption ${goalStatusMeta(row.status).tint}`}>
                        {goalStatusLabel(t.plugins.dev_lifecycle, row.status)}
                      </span>
                    )}
                    {row.afterCut
                      ? <span className={`typo-caption ${PLAN_INK.athena}`}>{t.ship.added_after_cut}</span>
                      : row.bucket === null
                        ? <span className="typo-caption text-foreground/60">{t.ship.unassigned}</span>
                        : null}
                  </span>
                )}
                actions={editable && (
                  <>
                    <Tooltip content={t.ship.promote_cut_tooltip}>
                      <button
                        type="button"
                        onClick={() => ship.setItem(vm.id, row.kind, row.id, 'core')}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring ${PLAN_INK.accent} ${PLAN_BORDER.accent}`}
                      >
                        <ArrowUp className="w-3 h-3" aria-hidden />
                        {t.ship.promote_cut}
                      </button>
                    </Tooltip>
                    {(['later', 'never'] as const).map((b) => (
                      <BucketBtn key={b} label={bucketLabel(t, b)} on={row.bucket === b} bucket={b}
                        onClick={() => ship.setItem(vm.id, row.kind, row.id, b)} />
                    ))}
                  </>
                )}
              />
            ))}
          </LedgerList>
        </>
      )}
    </div>
  );
}
