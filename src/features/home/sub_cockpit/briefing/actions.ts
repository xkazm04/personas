/**
 * Morning Director — the executor mapping each enum-validated widget
 * action onto EXISTING IPC.
 *
 * Action-carrying widgets composed by an LLM are a safety surface, so
 * actions follow the shared grammar: an explicit enum (never free-form,
 * see `./actionTypes`), validated on the Rust side against the
 * session-delta document AND re-validated on render, one click per
 * action, confirm when spendy/destructive (handled by
 * `WidgetActionBar`), and every execution recorded to the
 * `companion_decisions` audit ledger.
 */
import { executePersona } from '@/api/agents/executions';
import {
  companionApproveAction,
  companionRejectAction,
} from '@/api/companion';
import { companionRecordBriefingAction } from '@/api/companion/briefing';
import { useAgentStore } from '@/stores/agentStore';
import { silentCatch } from '@/lib/silentCatch';

import type { CockpitWidgetAction } from './actionTypes';

export {
  actionNeedsConfirm,
  parseWidgetActions,
  type CockpitWidgetAction,
  type CockpitWidgetActionKind,
} from './actionTypes';

/**
 * Execute one briefing action via existing IPC, then record it to the
 * decision ledger (best-effort — acting must not fail because the audit
 * write couldn't land). Throws the IPC error so the caller can render a
 * failed state.
 */
export async function runWidgetAction(
  action: CockpitWidgetAction,
  /** Human framing for the audit row — the action's rendered label. */
  auditLabel: string,
): Promise<void> {
  switch (action.kind) {
    case 'rerun_persona':
      await executePersona(action.personaId);
      break;
    case 'pause_persona':
      await useAgentStore
        .getState()
        .applyPersonaOp(action.personaId, { kind: 'ToggleEnabled', enabled: false });
      break;
    case 'approve_approval':
      await companionApproveAction(action.approvalId);
      break;
    case 'decline_approval':
      await companionRejectAction(action.approvalId);
      break;
  }
  const target =
    action.kind === 'rerun_persona' || action.kind === 'pause_persona'
      ? action.personaId
      : action.approvalId;
  companionRecordBriefingAction({
    label: auditLabel,
    choice: action.kind,
    rationale: 'morning_briefing',
    personaContext: target,
  }).catch(silentCatch('briefing_record_action'));
}
