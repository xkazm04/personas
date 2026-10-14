// One device as a plate of the strip: its name with a home marker, the
// reachability lamp, its load drawn as three thin bars (CPU, RAM, GPU - a null
// GPU draws no bar), running and queued as lamps with counts, and the last
// mutual-test verdict as a glyph whose detail is in its tooltip (a peer's
// only: nothing tests this device against itself). A device whose
// snapshot cannot be believed (`unknown`) greys out and swaps the bars for
// "last seen <ago>": a stale bar would be a confident lie about now.
//
// The whole plate is the press target: it scopes the board to this device, and
// pressing the scoped plate again returns the board to every device.

import { memo } from 'react';
import { CircleCheck, CircleDashed, CircleX, House, Laptop, Monitor } from 'lucide-react';
import type { DeviceReachability } from '@/lib/bindings/DeviceReachability';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { MeshLiveness } from '@/lib/bindings/MeshLiveness';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { Lamp as LampModel } from '../tone';
import { Lamp } from '../parts';
import { ResourceBars } from './ResourceBars';
import { deviceName } from './meshRead';

const REACH_LAMP: Record<DeviceReachability, LampModel> = {
  connected: { tone: 'ok', lit: true },
  stale: { tone: 'warn', lit: true },
  offline: { tone: 'off', lit: false },
};

function ProbeGlyph({ device }: { device: MeshDeviceView }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const probe = device.lastProbe;
  if (!probe) {
    return (
      <Tooltip content={m.mesh_probe_none} delay={300}>
        <CircleDashed className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-label={m.mesh_probe_none} data-testid="mesh-probe-none" />
      </Tooltip>
    );
  }
  // A skipped test is neither a pass nor a failure: neutral glyph, and its
  // detail ("skipped: <why>") carries the meaning.
  if (probe.skipped) {
    return (
      <Tooltip delay={300} content={<span className="flex flex-col"><span>{probe.testId}</span>{probe.detail && <span>{probe.detail}</span>}</span>}>
        <CircleDashed className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-label={probe.detail ?? probe.testId} data-testid="mesh-probe-skipped" />
      </Tooltip>
    );
  }
  const Icon = probe.passed ? CircleCheck : CircleX;
  const verdict = tx(probe.passed ? m.mesh_probe_passed : m.mesh_probe_failed, { test: probe.testId });
  return (
    <Tooltip
      delay={300}
      content={(
        <span className="flex flex-col">
          <span>{verdict} <RelativeTime timestamp={probe.atMs} showTooltip={false} /></span>
          {probe.detail && <span>{probe.detail}</span>}
        </span>
      )}
    >
      <Icon
        className={`h-3.5 w-3.5 flex-shrink-0 ${probe.passed ? 'text-status-success' : 'text-status-error'}`}
        aria-label={verdict}
        data-testid={probe.passed ? 'mesh-probe-passed' : 'mesh-probe-failed'}
      />
    </Tooltip>
  );
}

export const DevicePlate = memo(function DevicePlate({
  device, liveness, selected, onPick,
}: {
  device: MeshDeviceView;
  liveness: MeshLiveness;
  selected: boolean;
  onPick: (peerId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const name = device.isSelf ? m.mesh_this_device : deviceName(device);
  const snap = device.snapshot;
  const stale = liveness === 'unknown';
  const reach = device.isSelf ? 'connected' : device.reachability;
  const reachLabel = { connected: m.mesh_reach_connected, stale: m.mesh_reach_stale, offline: m.mesh_reach_offline }[reach];
  const Kind = device.isSelf ? Monitor : Laptop;
  const aria = [name, device.isSelf ? deviceName(device) : null, stale ? m.mesh_not_reporting : reachLabel,
    selected ? m.mesh_plate_clear : tx(m.mesh_plate_scope, { device: name })].filter(Boolean).join(', ');

  return (
    <Button
      variant="ghost"
      onClick={() => onPick(device.peerId)}
      aria-pressed={selected}
      aria-label={aria}
      data-testid={device.isSelf ? 'mesh-plate-self' : 'mesh-plate'}
      data-peer-id={device.peerId}
      data-liveness={liveness}
      className={`ae-win ae-focus w-52 flex-shrink-0 rounded-input px-2.5 py-1.5 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1 ${
        selected ? 'is-selected is-lit ae-t-run' : ''} ${stale ? 'grayscale' : ''}`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <Lamp lamp={stale ? { tone: 'off', lit: false } : REACH_LAMP[reach]} label={stale ? m.mesh_not_reporting : reachLabel} />
        <Kind className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-hidden />
        <span className={`min-w-0 flex-1 truncate typo-heading ${selected ? 'text-primary' : 'text-foreground'}`}>{name}</span>
        {device.isHome && <House className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-label={m.mesh_home} data-testid="mesh-home" />}
        {!device.isSelf && <ProbeGlyph device={device} />}
      </span>
      {stale || !snap ? (
        <span className="flex min-h-[1.75rem] items-center truncate typo-caption" data-testid="mesh-plate-last-seen">
          {device.receivedAtMs !== null
            ? <>{m.remote_last_seen}&nbsp;<RelativeTime timestamp={device.receivedAtMs} showTooltip={false} /></>
            : m.remote_never_seen}
        </span>
      ) : (
        <span className="flex w-full min-w-0 items-center gap-2.5">
          <ResourceBars cpu={snap.host.cpuShare} ram={snap.host.ramShare} gpu={snap.host.gpuShare} className="flex-1" testId="mesh-plate-bars" />
          <span className="flex flex-shrink-0 flex-col items-end typo-data tabular-nums text-foreground">
            <span className="inline-flex items-center gap-1" aria-label={tx(m.mesh_running, { count: snap.running })}>
              <Lamp lamp={{ tone: 'run', lit: snap.running > 0 }} />{snap.running}
            </span>
            <span className="inline-flex items-center gap-1" aria-label={tx(m.mesh_queued, { count: snap.queued })}>
              <Lamp lamp={{ tone: 'info', lit: snap.queued > 0 }} />{snap.queued}
            </span>
          </span>
        </span>
      )}
    </Button>
  );
});
