/**
 * The ledger's status cell: the turn glyph (the non-colour signal the Board's
 * lanes used to carry), the status badge, and - only for a goal awaiting
 * acceptance - the shared accept / send-back gesture.
 *
 * The controls swallow their own click and keydown: the row's click opens the
 * drawer and the table's Enter/Space activates the focused row, and neither
 * may fire when the user is accepting a goal.
 */
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { AcceptRejectControls } from '../acceptancePrimitives';
import { GoalStatusBadge } from '../GoalStatusBadge';
import { isAwaitingAcceptance } from '../goalStatus';
import { laneSignal } from './ledgerSignals';

export function LedgerStatusCell({ goalId, status, onSettled, onOpen }: { goalId: string; status: string; onSettled?: () => void; onOpen?: () => void }) {
  const { t } = useTranslation();
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const sig = laneSignal(status);
  const Glyph = sig.icon;
  const label = t.plugins.dev_tools[sig.labelKey];

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Tooltip content={label}>
        <span data-testid={`ledger-turn-${goalId}`} aria-label={label} role="img" className="inline-flex shrink-0">
          <Glyph className={`w-3.5 h-3.5 ${sig.tint}`} />
        </span>
      </Tooltip>
      <GoalStatusBadge status={status} />
      {isAwaitingAcceptance(status) && (
        <div
          data-testid={`ledger-accept-${goalId}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <AcceptRejectControls
            size="sm"
            onSendBackIntent={onOpen}
            onAccept={() => { void acceptGoal(goalId).then(onSettled).catch(toastCatch('Failed to accept goal')); }}
            onReject={(comment) => { void rejectGoal(goalId, comment).then(onSettled).catch(toastCatch('Failed to send the goal back')); }}
          />
        </div>
      )}
    </div>
  );
}
