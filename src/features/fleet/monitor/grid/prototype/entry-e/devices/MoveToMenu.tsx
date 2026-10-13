// "Move to…" on a LOCAL queued rung: the paired devices as a menu (the shared
// `ContextMenu`, anchored under the button). Picking one sends the entry there
// as a fleet session job; the local entry is cancelled only once the device
// accepts (reason `moved:<peer8>`), which is what removes the rung. Until then
// the rung reads "Moving to <device>", and a refusal leaves it where it was
// with the device's reason on it (`MeshOutcomeLine`).
//
// No paired device, no button: there is nowhere to move to.

import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, House, Laptop } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { useSystemStore } from '@/stores/systemStore';
import { moveOutcomeKey } from '@/stores/slices/network/meshSlice';
import { deviceName, peerDevices } from './meshRead';
import { useMeshOutcome } from './MeshOutcomeLine';

export const MoveToMenu = memo(function MoveToMenu({ sessionId, label }: { sessionId: string; label: string }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { devices, liveness, move } = useSystemStore(useShallow((s) => ({
    devices: s.meshDevices,
    liveness: s.meshLiveness,
    move: s.moveQueuedToDevice,
  })));
  const peers = useMemo(() => peerDevices(devices), [devices]);
  const outcome = useMeshOutcome(moveOutcomeKey(sessionId));
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (peers.length === 0) return null;

  const items: ContextMenuItem[] = peers.map((d) => {
    const stale = liveness[d.peerId] !== 'live';
    return {
      id: d.peerId,
      label: deviceName(d),
      icon: d.isHome ? <House className="h-3.5 w-3.5" /> : <Laptop className="h-3.5 w-3.5" />,
      hint: stale ? m.mesh_move_waits : undefined,
      testId: 'mesh-move-target',
      onSelect: () => { void move(sessionId, d.peerId); },
    };
  });

  return (
    <>
      <Tooltip content={m.mesh_move_to}>
        <Button
          variant="ghost"
          size="icon-sm"
          loading={outcome?.state === 'pending'}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ x: r.left, y: r.bottom + 4 });
          }}
          aria-label={tx(m.mesh_move_aria, { name: label })}
          aria-haspopup="menu"
          aria-expanded={at !== null}
          data-testid="mesh-move-to"
          icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
        />
      </Tooltip>
      {at && createPortal(
        <ContextMenu x={at.x} y={at.y} items={items} onClose={() => setAt(null)} ariaLabel={m.mesh_move_to} widthClass="w-60" />,
        document.body,
      )}
    </>
  );
});
