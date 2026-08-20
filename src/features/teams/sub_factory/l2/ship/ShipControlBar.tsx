// The milestone's control panel — one toolbar for every verb.
//
// The five actions used to be in four places: the lifecycle button and Compose
// floated right of the header, Run and Ingest sat in their own strip below the
// duality summary, and the criteria — the thing certification is actually
// gated on — were a permanent chip row with their evidence buried in native
// `title=` tooltips. There was no single answer to "what can I do to this
// milestone", and the two most consequential acts (certify, dispatch a fleet at
// a gap) were the least visible.
//
// One bar, ordered by how far each verb reaches:
//
//   Certify · Compose scope   — change the milestone itself
//   Run · Ingest              — hand the cut to a CLI skill and read it back
//   Ask Athena                — think about it with someone
//
// The separator is not decoration: the middle pair leaves the app and comes
// back, which is a different kind of commitment from the first pair, and the
// last one changes nothing at all.
import { Download, MessagesSquare, PencilRuler, Rocket, SquareTerminal } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

import { INK } from '../../passport/passportInk';
import { CRIT_HUE, shipVerdict, type ShipMilestoneVM } from './shipModel';

/** Shared shape for the bar's plain (non-async) buttons. */
function BarButton({ hue, icon, label, tip, onClick, testId }: {
  hue: string;
  icon: React.ReactNode;
  label: string;
  tip: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring"
        style={{ color: hue, borderColor: `${hue}55` }}
        data-testid={testId}
      >
        {icon}
        {label}
      </button>
    </Tooltip>
  );
}

export function ShipControlBar({
  vm, project, editable,
  onCertify, onCompose, onAskAthena,
  onRun, onIngest, running, ingesting,
}: {
  vm: ShipMilestoneVM;
  project: DevProject | null;
  /** False once shipped — a shipped milestone is a record, not a workspace. */
  editable: boolean;
  /** Opens the certify panel (which is where the exit criteria now live). */
  onCertify: () => void;
  onCompose: () => void;
  onAskAthena: () => void;
  onRun: () => Promise<void>;
  onIngest: () => Promise<void>;
  running: boolean;
  ingesting: boolean;
}) {
  const { t, tx } = useTranslation();

  const verdict = shipVerdict(vm.criteria);
  const cutting = vm.status === 'planned';
  const unmet = vm.criteria.filter((c) => c.state !== 'go').length;

  // Athena is available even on a shipped milestone: "why did this go the way
  // it did" is a legitimate question about a record, and the button writes
  // nothing.
  const athenaBtn = (
    <BarButton
      hue={INK.violet}
      icon={<MessagesSquare className="w-3.5 h-3.5" aria-hidden />}
      label={t.ship.ask_athena}
      tip={t.ship.ask_athena_tooltip}
      onClick={onAskAthena}
      testId="ship-ask-athena"
    />
  );

  if (!editable) {
    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid="ship-control-bar">
        {athenaBtn}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="ship-control-bar">
      {/* Certify carries the criteria READING on its own face — the count of
          what is unmet, in the verdict's colour. The chip row was five
          permanent pills to say this; a badge on the button that opens them
          says it in the one place it changes a decision. */}
      <Tooltip content={cutting ? t.ship.certify_cut_tooltip : verdict === 'go' ? t.ship.certify_ship_tooltip : t.ship.certify_blocked_tooltip}>
        <button
          type="button"
          onClick={onCertify}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring"
          style={{ color: INK.emerald, borderColor: `${INK.emerald}55` }}
          data-testid="ship-lifecycle-action"
        >
          <Rocket className="w-3.5 h-3.5" aria-hidden />
          {cutting ? t.ship.certify_cut : t.ship.certify_ship}
          <span
            className="ml-0.5 px-1.5 rounded-full typo-data tabular-nums"
            style={{ color: CRIT_HUE[verdict], background: `color-mix(in srgb, ${CRIT_HUE[verdict]} 14%, transparent)` }}
            aria-label={tx(t.ship.criteria_badge_aria, { unmet, total: vm.criteria.length })}
          >
            {unmet === 0 ? `${vm.criteria.length}/${vm.criteria.length}` : `${vm.criteria.length - unmet}/${vm.criteria.length}`}
          </span>
        </button>
      </Tooltip>

      <BarButton
        hue={INK.teal}
        icon={<PencilRuler className="w-3.5 h-3.5" aria-hidden />}
        label={t.ship.compose_scope}
        tip={t.ship.compose_scope_tooltip}
        onClick={onCompose}
        testId="ship-compose-open"
      />

      <span className="w-px h-5 bg-foreground/[0.12] mx-0.5" aria-hidden />

      <Tooltip content={t.ship.run_milestone_tooltip}>
        <AsyncButton
          isLoading={running}
          disabled={!project}
          // `onRun()` not `void onRun()`: AsyncButton disarms double-submit by
          // awaiting the promise its onClick returns, and `void` throws that
          // promise away — see the note in ShipDispatch, where two presses in
          // one frame produced two Fleet sessions.
          onClick={() => onRun()}
          icon={<SquareTerminal className="w-3.5 h-3.5" aria-hidden />}
          data-testid="ship-run-milestone"
        >
          {t.ship.run_milestone}
        </AsyncButton>
      </Tooltip>

      <Tooltip content={t.ship.run_ingest_tooltip}>
        <AsyncButton
          isLoading={ingesting}
          onClick={() => onIngest()}
          icon={<Download className="w-3.5 h-3.5" aria-hidden />}
          data-testid="ship-ingest-run"
        >
          {t.ship.run_ingest}
        </AsyncButton>
      </Tooltip>

      <span className="w-px h-5 bg-foreground/[0.12] mx-0.5" aria-hidden />

      {athenaBtn}
    </div>
  );
}
