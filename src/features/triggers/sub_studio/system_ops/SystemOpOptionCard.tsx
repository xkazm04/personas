/**
 * Rail card for one available system operation (Chain Studio right rail,
 * "System events" tab). Mirrors {@link TriggerOptionCard} / persona cards but
 * represents a built-in op target rather than a persona. Single dense row —
 * the description surfaces as a hover tooltip.
 */
import { Cog } from 'lucide-react';
import type { SystemOpKindMeta } from '@/api/systemOps';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { PressSurface } from '@/features/shared/components/buttons';
export function SystemOpOptionCard({
  kind, active, onPick,
}: {
  kind: SystemOpKindMeta;
  active?: boolean;
  onPick: () => void;
}) {
  return (
    <Tooltip content={kind.description} placement="left">
      <PressSurface onPress={onPick} selected={active} className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded-card border border-hair">
        <div className="rounded-input flex items-center justify-center shrink-0 bg-surface-2 w-7 h-7 text-role-agent">
          <Cog className="w-4 h-4" />
        </div>
        <div className="typo-body text-ink-1 truncate min-w-0 flex-1">{kind.label}</div>
      </PressSurface>
    </Tooltip>
  );
}
