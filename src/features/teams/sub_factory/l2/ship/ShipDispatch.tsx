// Ship-layer Fleet dispatch — the resolution arm of the exit criteria.
// Evaluation stays derived (useShipData); when a criterion is NOT met, the
// chip grows an action that dispatches a Fleet Dev-runner session into the
// project's repo root with a criterion-specific brief, via the SAME machinery
// the passport wall ships (passportDispatchKey naming → usePassportFleetSessions
// picks it up → PassportTerminalModal is the door). Consent-first: the prompt
// is shown and editable before anything spawns.
import { useState } from 'react';
import { Rocket } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { DevProject } from '@/lib/bindings/DevProject';
import { toastCatch } from '@/lib/silentCatch';

import { dispatchRowToFleet, passportDispatchKey } from '../../passport/passportFleet';
import { INK } from '../../passport/passportInk';
import type { ExitCriterion, ShipMilestoneVM } from './shipModel';

/** Session key: `passport:ship-<criterion>:<projectId>` — the `passport:`
 *  prefix keeps it inside usePassportFleetSessions' watch window. */
export function shipDispatchKey(critId: string, projectId: string): string {
  return passportDispatchKey(`ship-${critId}`, projectId);
}

/** The goal-assist brief — the "too many contexts to comprehend" helper. The
 *  user states an idea/goal; the agent does the categorization and the work:
 *  assign contexts, execute what's feasible, update the goal's metadata, and
 *  leave the milestone item flagged for manual review. Dispatched through the
 *  universal DispatchChooser (Dev runner / Fleet / CLI). */
export function buildGoalAssistPrompt(
  goal: { name: string; description: string | null; status: string },
  vm: ShipMilestoneVM,
  project: DevProject,
): string {
  return [
    `You are working in the "${project.name}" repository. The operator wrote this goal without categorizing it — do the comprehension work for them.`,
    '',
    `GOAL: ${goal.name}`,
    goal.description ? `DETAIL: ${goal.description}` : null,
    `STATUS: ${goal.status} · bound to milestone "${vm.name}"${vm.goal ? ` (${vm.goal})` : ''}`,
    '',
    'Jobs, in order:',
    '1. ASSIGN CONTEXTS — study the codebase\'s context map (context-map.json at the repo root if present, otherwise infer from the directory structure) and identify which contexts/areas this goal touches. Record the mapping.',
    '2. EXECUTE — if the goal is actionable now, implement it (surgical changes, run relevant tests). If it is too large, break it into concrete steps and complete the first one.',
    '3. UPDATE GOAL METADATA — refine the goal\'s description with what you learned (touched areas, approach, remaining steps) and an honest progress estimate.',
    '4. FLAG FOR REVIEW — finish with a "MANUAL REVIEW" summary block: what changed, what was assigned where, and what the operator should verify before accepting the milestone item.',
    '',
    'If the Personas management API is reachable (http://127.0.0.1:9420), use it to persist the goal updates; otherwise write SHIP_GOAL_REPORT.md at the repo root with the same content — the operator ingests it manually.',
  ].filter((l): l is string => l !== null).join('\n');
}

/** The criterion-specific brief. Only criteria with agent-shaped work get
 *  one; everything else returns null and the chip grows no lightning.
 *  `objective` (bind a goal), `sensors` (bind connectors) and `scope-frozen`
 *  (accept or drop what joined late) are human scoping decisions, not work an
 *  agent can do on your behalf, so they fall through to the default null. */
export function buildCriterionPrompt(vm: ShipMilestoneVM, c: ExitCriterion, project: DevProject): string | null {
  if (c.id === 'contexts') {
    const crit = vm.footprint.filter((x) => x.tone === 'crit');
    const warn = vm.footprint.filter((x) => x.tone === 'warn');
    if (crit.length === 0 && warn.length === 0) return null;
    const lines = [...crit, ...warn]
      .map((x) => `- ${x.name}: ${x.errors ?? '?'} errors this week${x.tone === 'crit' ? ' (CRITICAL)' : ''}`)
      .join('\n');
    return [
      `You are working in the "${project.name}" repository.`,
      `Milestone "${vm.name}"${vm.goal ? ` (${vm.goal})` : ''} is blocked by unhealthy contexts in its core scope:`,
      lines,
      '',
      'Investigate the recent errors in these areas (check Sentry/log traces where available), identify the highest-impact root causes, and fix them. Keep changes surgical and scoped to these contexts. Run the relevant tests before finishing, and summarize what was fixed and what remains.',
    ].join('\n');
  }
  if (c.id === 'skill-coverage') {
    const uncovered = vm.footprint.filter((x) => !vm.skillCoverage.some((s) => s.contextIds.has(x.id)));
    if (uncovered.length === 0) return null;
    // Which skill to run is the OPERATOR's call, not this function's. Naming one
    // here would make the dispatch prompt assert that /perfect (say) is the
    // right instrument for whatever this milestone touches, which is a judgement
    // nothing in the data supports. The prompt states the gap and the evidence
    // rule; the session picks, and the consent surface shows the prompt before
    // anything spawns.
    const ran = vm.skillCoverage.map((s) => s.skill);
    return [
      `You are working in the "${project.name}" repository.`,
      `Milestone "${vm.name}"${vm.goal ? ` (${vm.goal})` : ''} has contexts in its cut that no skill has looked at in the last 30 days:`,
      uncovered.map((x) => `- ${x.name}`).join('\n'),
      '',
      ran.length > 0
        ? `Skills that HAVE left insight on this project recently: ${ran.join(', ')}. Prefer continuing one of those over introducing a new one — coverage is only comparable across contexts if the same instrument produced it.`
        : 'No skill has left insight on this project in the last 30 days, so there is no established instrument to continue. Say which one you chose and why before you run it.',
      '',
      'Run the appropriate scan skill over those contexts. What makes this count as coverage is not that the skill RAN — it is that it left durable, context-attributed insight behind, so the next session starts from what this one learned rather than re-deriving it.',
      '',
      'Two things to be honest about in your summary: which contexts you actually covered (not which you intended to), and any context where you looked and concluded there was nothing worth recording — that is a real finding and it is different from not having looked.',
    ].join('\n');
  }
  if (c.id === 'kpi') {
    const uncovered = vm.footprint.filter((x) => x.kpis === 0);
    if (uncovered.length === 0) return null;
    return [
      `You are working in the "${project.name}" repository.`,
      `Milestone "${vm.name}"${vm.goal ? ` (${vm.goal})` : ''} lacks KPI coverage on part of its core scope. Contexts without any active KPI:`,
      uncovered.map((x) => `- ${x.name}`).join('\n'),
      '',
      'For each listed area, propose 1-2 concrete, measurable KPIs (name, unit, direction, a defensible baseline and target, and HOW to measure them from this codebase or its telemetry). Write the proposals to a markdown summary at the end — the operator will accept them into the KPI module.',
    ].join('\n');
  }
  return null;
}

/** Consent modal: criterion evidence + the editable brief + one Dispatch. */
export function ShipDispatchModal({ vm, criterion, project, onDispatched, onClose }: {
  vm: ShipMilestoneVM;
  criterion: ExitCriterion;
  project: DevProject;
  /** Called with the dispatch key after the session spawns. */
  onDispatched: (key: string) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const [prompt, setPrompt] = useState(() => buildCriterionPrompt(vm, criterion, project) ?? '');
  const [busy, setBusy] = useState(false);
  const key = shipDispatchKey(criterion.id, project.id);

  const dispatch = async () => {
    setBusy(true);
    try {
      await dispatchRowToFleet(key, project.root_path, prompt);
      onDispatched(key);
    } catch (e) {
      toastCatch('ship dispatch')(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="ship-dispatch-title" portal maxWidthClass="max-w-2xl" staggerChildren={false}>
      <div data-testid="ship-dispatch-modal">
        <h2 id="ship-dispatch-title" className="typo-title-lg mb-1">{tx(t.ship.dispatch_crit_title, { label: criterion.label })}</h2>
        <p className="typo-caption mb-3">{criterion.evidence}</p>
        <p className="typo-caption mb-1.5" style={{ color: INK.blue }}>{t.ship.dispatch_crit_hint}</p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          className="w-full rounded-input border border-foreground/[0.12] bg-background/70 px-3 py-2 typo-caption text-foreground/90 outline-none focus:border-primary/40 resize-y"
          data-testid="ship-dispatch-prompt"
        />
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-interactive typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring"
          >
            {t.common.cancel}
          </button>
          <AsyncButton
            isLoading={busy}
            disabled={prompt.trim().length === 0}
            // `dispatch()` not `void dispatch()`. AsyncButton disarms
            // double-submit by awaiting the promise its onClick returns; `void`
            // discards that promise, so the guard has nothing to await and the
            // button stays live. Replayed statement-for-statement: two presses
            // inside one commit frame produced TWO Fleet sessions; returning the
            // promise holds it at one at every gap.
            onClick={() => dispatch()}
            icon={<Rocket className="w-3.5 h-3.5" aria-hidden />}
            data-testid="ship-dispatch-confirm"
          >
            {t.common.dispatch_action}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
