// The device strip: one row under the command band, one plate per device in
// the mesh - 'All' first, then this device, then every paired device. It is
// the board's device filter: a plate scopes the board to its device and the
// lit plate is the scope.
//
// With no paired device the strip renders NOTHING - not an empty row, not a
// lone "This device" plate. A one-machine operator never learns it exists.

import { memo } from 'react';
import { Network } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Lamp } from '../parts';
import { DevicePlate } from './DevicePlate';
import { livenessOf } from './meshRead';
import { useMeshDevices } from './useMeshDevices';

export const DeviceStrip = memo(function DeviceStrip() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { self, peers, liveness, filter, setFilter, toggle } = useMeshDevices();
  if (peers.length === 0) return null;

  const live = peers.filter((p) => livenessOf(liveness, p) === 'live').length + (self ? 1 : 0);
  const total = peers.length + (self ? 1 : 0);
  const all = filter === 'all';

  return (
    <div
      role="group"
      aria-label={m.mesh_strip_aria}
      className="flex flex-shrink-0 items-stretch gap-2 overflow-x-auto border-b border-border px-3 py-2"
      data-testid="mesh-device-strip"
    >
      <Button
        variant="ghost"
        onClick={() => setFilter('all')}
        aria-pressed={all}
        aria-label={`${m.mesh_all}, ${tx(m.mesh_devices_live, { live, total })}`}
        data-testid="mesh-plate-all"
        className={`ae-win ae-focus flex-shrink-0 rounded-input px-3 py-1.5 [&>span]:flex [&>span]:flex-col [&>span]:items-start [&>span]:gap-1 ${
          all ? 'is-selected is-lit ae-t-run' : ''}`}
      >
        <span className="flex items-center gap-1.5">
          <Lamp lamp={{ tone: 'run', lit: all }} />
          <Network className="h-3.5 w-3.5 text-foreground" aria-hidden />
          <span className={`typo-heading ${all ? 'text-primary' : 'text-foreground'}`}>{m.mesh_all}</span>
        </span>
        <span className="typo-caption tabular-nums">{tx(m.mesh_devices_live, { live, total })}</span>
      </Button>
      {self && (
        <DevicePlate device={self} liveness="live" selected={filter === self.peerId} onPick={toggle} />
      )}
      {peers.map((p) => (
        <DevicePlate key={p.peerId} device={p} liveness={livenessOf(liveness, p)} selected={filter === p.peerId} onPick={toggle} />
      ))}
    </div>
  );
});
