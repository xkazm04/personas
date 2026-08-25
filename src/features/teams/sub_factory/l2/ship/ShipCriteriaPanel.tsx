// The exit criteria, inline — where the cut they are measured against is.
//
// HISTORY, because this is the second move and the first one had a reason.
// They began as a permanent chip row in the milestone header: five pills, each
// compressing a whole derived evidence line into a native `title=` tooltip —
// the one channel that reaches neither keyboard nor touch. That was rightly
// retired into a certify modal, and the note left behind said the criteria
// "only matter at the moment you ask 'can this ship?'".
//
// The operator's 2026-08-25 ruling moves them back into the page, and the two
// positions reconcile once you separate what was actually wrong: the defect was
// COMPRESSION, not placement. A chip that hides its evidence is useless
// wherever it sits; a row that reads its evidence in the layout is useful
// wherever it sits. So they return as full evidence rows, never as chips, and
// the modal keeps only the commit.
//
// The other half of the ruling is why this can be inline at all: the cut now
// renders goals as well as features, so the planner is a complete reading of
// the milestone. Criteria beside a cut that showed none of the work would have
// been two half-readings on one page.
import { useState } from 'react';
import { SquareTerminal, Zap } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

import {
  PASSPORT_FLEET_INK, PassportTerminalModal, usePassportFleetSessions,
} from '../../passport/passportFleet';
import { INK } from '../../passport/passportInk';
import { buildCriterionPrompt, ShipDispatchModal, shipDispatchKey } from './ShipDispatch';
import { CRIT_HUE, type ExitCriterion, type ShipMilestoneVM } from './shipModel';

/** One criterion, with its evidence readable instead of hidden in a tooltip. */
function CriterionRow({ c, vm, project, onDispatch, onOpenTerminal }: {
  c: ExitCriterion;
  vm: ShipMilestoneVM;
  project: DevProject | null;
  onDispatch: (c: ExitCriterion) => void;
  onOpenTerminal: (key: string) => void;
}) {
  const { t, tx } = useTranslation();
  const fleetSessions = usePassportFleetSessions();
  const key = project ? shipDispatchKey(c.id, project.id) : null;
  const session = key ? fleetSessions.get(key) : undefined;
  // A criterion only grows a resolution arm when the gap is work an agent can
  // do. `objective`, `sensors` and `scope-frozen` are human scoping decisions
  // and deliberately return null from `buildCriterionPrompt`.
  const dispatchable = c.state !== 'go' && project !== null && buildCriterionPrompt(vm, c, project) !== null;
  const hue = CRIT_HUE[c.state];

  return (
    <li
      className="flex items-start gap-3 rounded-card border px-3 py-2.5"
      style={{ borderColor: `${hue}33`, background: `color-mix(in srgb, ${hue} 4%, transparent)` }}
      data-testid={`ship-criterion-${c.id}`}
    >
      <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: hue }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="typo-title">{c.label}</span>
          <span className="typo-data tabular-nums shrink-0" style={{ color: hue }}>{c.done}/{c.total}</span>
        </span>
        {/* The evidence line is DERIVED prose, never hand-typed (shipCriteria.ts).
            It is the answer to "why is this criterion where it is", so it reads
            in the layout rather than on hover. */}
        <span className="typo-caption block mt-0.5">{c.evidence}</span>
      </span>
      {session && key ? (
        <Tooltip content={tx(t.ship.session_open_tooltip, { state: String(session.state).replace('_', ' ') })}>
          <button
            type="button"
            onClick={() => onOpenTerminal(key)}
            aria-label={tx(t.ship.session_open_aria, { label: c.label })}
            className="shrink-0 p-1.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
          >
            <SquareTerminal className="w-4 h-4" style={{ color: PASSPORT_FLEET_INK[String(session.state)] ?? 'rgba(148,163,184,.6)' }} aria-hidden />
          </button>
        </Tooltip>
      ) : dispatchable ? (
        <Tooltip content={t.ship.dispatch_gap_tooltip}>
          <button
            type="button"
            onClick={() => onDispatch(c)}
            aria-label={tx(t.ship.dispatch_gap_aria, { label: c.label })}
            className="shrink-0 p-1.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
            data-testid={`ship-dispatch-${c.id}`}
          >
            <Zap className="w-4 h-4" style={{ color: INK.violet }} aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </li>
  );
}

/**
 * Every criterion, with the resolution arm wired.
 *
 * Owns the dispatch + terminal modal state so a caller can drop the list
 * anywhere without re-deriving it. Renders NOTHING when there are no criteria,
 * rather than an empty panel — a milestone with no registered criteria is a
 * registry problem, and a heading over nothing would report it as a milestone
 * problem.
 */
export function ShipCriteriaList({ vm, project }: {
  vm: ShipMilestoneVM;
  project: DevProject | null;
}) {
  const [dispatchCrit, setDispatchCrit] = useState<ExitCriterion | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  const fleetSessions = usePassportFleetSessions();

  if (vm.criteria.length === 0) return null;

  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="ship-criteria-list">
        {vm.criteria.map((c) => (
          <CriterionRow
            key={c.id}
            c={c}
            vm={vm}
            project={project}
            onDispatch={setDispatchCrit}
            onOpenTerminal={setTerminalKey}
          />
        ))}
      </ul>

      {dispatchCrit && project && (
        <ShipDispatchModal
          vm={vm}
          criterion={dispatchCrit}
          project={project}
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
    </>
  );
}
