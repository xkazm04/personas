// A session running on ANOTHER device, as a line of its bay: the same Board
// tile a local session wears (`SessionLine`), folded into the same piles, with
// a laptop on the puck where a local card has its origin, and the device
// under the title. A remote row whose state could not be read is off.

import { memo } from 'react';
import { Laptop } from 'lucide-react';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import { pileSkin, sessionPileKey } from './pileSkin';

export const RemoteLine = memo(function RemoteLine({
  view, now, onOpen,
}: {
  view: RemoteSessionView;
  now: number;
  onOpen?: (jobId: string) => void;
}) {
  const state = effectiveRemoteState(view, now);
  const skin = pileSkin(state === 'unknown' ? 'off' : sessionPileKey({ state, exitCode: null }), view.jobId);
  const title = view.title?.trim() || view.projectLabel || view.jobId.slice(0, 8);
  const device = view.peerDisplayName || view.peerId.slice(0, 8);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(view.jobId)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(view.jobId); }}
      data-testid="fleet-grid-remote"
      data-pile={skin.pile}
      className={`${skin.className} flex min-w-0 items-center gap-2 py-1.5 pl-1.5 pr-2.5`}
      style={skin.style}
    >
      <span className="fb-face fb-ink ae-puck" aria-hidden><Laptop className="h-4 w-4" /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate typo-heading">{title}</span>
        <span className="truncate typo-label">{device}</span>
      </span>
    </div>
  );
});
