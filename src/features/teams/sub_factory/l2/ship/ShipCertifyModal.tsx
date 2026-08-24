// Where the exit criteria live now.
//
// They used to sit as a permanent chip row in the milestone header — five
// pills, every one of them showing a fraction, on screen at all times whether
// or not anyone was about to certify anything. That is the wrong altitude for
// them twice over: the header is for what the milestone IS, and the criteria
// only matter at the moment you ask "can this ship?". Worse, the chips had to
// compress a whole derived evidence line into a native `title=` tooltip, which
// is the one channel that reaches neither keyboard nor touch.
//
// So certification became a two-beat act. The toolbar button asks the question;
// this panel answers it with the full evidence, offers the resolution arm for
// the gaps an agent can actually close, and puts the commit at the bottom where
// a decision belongs. The verdict gate is unchanged — `shipVerdict` over the
// criteria registry, and nothing else.
import { useState } from 'react';
import { Check, Rocket, SquareTerminal, Zap } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

import {
  PASSPORT_FLEET_INK, PassportTerminalModal, usePassportFleetSessions,
} from '../../passport/passportFleet';
import { INK } from '../../passport/passportInk';
import { buildCriterionPrompt, ShipDispatchModal, shipDispatchKey } from './ShipDispatch';
import { CRIT_HUE, shipVerdict, type ExitCriterion, type ShipMilestoneVM } from './shipModel';

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

export function ShipCertifyModal({ vm, project, onCertify, onClose }: {
  vm: ShipMilestoneVM;
  project: DevProject | null;
  /** Advance the lifecycle: planned → active (cut), active → shipped. */
  onCertify: () => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const [dispatchCrit, setDispatchCrit] = useState<ExitCriterion | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  const fleetSessions = usePassportFleetSessions();

  const verdict = shipVerdict(vm.criteria);
  const cutting = vm.status === 'planned';
  // Cutting FREEZES the scope (it stamps `cut_at`, which is what makes
  // `added_after_cut` mean anything); shipping is the gated act. Blocking a cut
  // on the criteria would be backwards — the criteria are measured against the
  // cut, so they cannot be a precondition for making one.
  const blocked = !cutting && verdict !== 'go';

  return (
    <>
      <BaseModal isOpen onClose={onClose} titleId="ship-certify-title" portal maxWidthClass="max-w-2xl" staggerChildren={false}>
        <div data-testid="ship-certify-modal">
          <h2 id="ship-certify-title" className="typo-title-lg mb-1">
            {cutting ? tx(t.ship.certify_cut_title, { name: vm.name }) : tx(t.ship.certify_ship_title, { name: vm.name })}
          </h2>
          <p className="typo-caption mb-4">
            {cutting ? t.ship.certify_cut_intro : t.ship.certify_ship_intro}
          </p>

          <ul className="flex flex-col gap-2 mb-4" data-testid="ship-criteria-list">
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

          <div className="flex items-center justify-between gap-3">
            <p className="typo-caption min-w-0" style={{ color: blocked ? INK.amber : undefined }}>
              {blocked ? t.ship.certify_blocked_tooltip : cutting ? t.ship.certify_cut_tooltip : t.ship.certify_ship_tooltip}
            </p>
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-interactive typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring"
              >
                {t.common.cancel}
              </button>
              <AsyncButton
                disabled={blocked}
                onClick={() => { onCertify(); onClose(); }}
                icon={cutting ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Rocket className="w-3.5 h-3.5" aria-hidden />}
                data-testid="ship-certify-confirm"
              >
                {cutting ? t.ship.certify_cut : t.ship.certify_ship}
              </AsyncButton>
            </span>
          </div>
        </div>
      </BaseModal>

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
