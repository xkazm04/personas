// MeshBoard - where the board's device filter becomes layout.
//
//   'All' with live peers   this device's board, and beside it a rail with one
//                           bay per live paired device (agents, queue, and the
//                           sessions sent there);
//   a peer                  only that device's bay, wide;
//   'This device' / no mesh the board exactly as it was - `children`, untouched.
//
// The board panels (Classic, Lanes) are not told about the mesh at all: the
// local board is still theirs, and a device's bay is composed beside it.

import { useTranslation } from '@/i18n/useTranslation';
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';
import type { ReactNode } from 'react';
import type { ActivitySurface } from '../../useActivitySurface';
import { PeerBay } from './PeerBay';

const TICK_MS = 30_000;

export function MeshBoard({
  surface, onOpenRemote, children,
}: {
  surface: ActivitySurface;
  onOpenRemote?: (jobId: string) => void;
  /** The local board (the layout's panel, or its ghost). */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const now = useQuantizedNow(TICK_MS);
  const { peerColumns, peerScope } = surface.unfilteredModel;

  if (peerScope) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="mesh-peer-board">
        <div className="mx-auto flex max-w-5xl flex-col gap-2.5">
          {peerColumns.map((p) => (
            <PeerBay key={p.peerId} peer={p} now={now} reducedMotion={surface.reducedMotion} wide onOpenRemote={onOpenRemote} />
          ))}
        </div>
      </div>
    );
  }
  if (peerColumns.length === 0) return <>{children}</>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <aside
        aria-label={t.monitor.mesh_rail_aria}
        className="flex w-72 flex-shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border p-3"
        data-testid="mesh-peer-rail"
      >
        {peerColumns.map((p) => (
          <PeerBay key={p.peerId} peer={p} now={now} reducedMotion={surface.reducedMotion} onOpenRemote={onOpenRemote} />
        ))}
      </aside>
    </div>
  );
}
