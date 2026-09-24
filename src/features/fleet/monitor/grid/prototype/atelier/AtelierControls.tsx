// Atelier header controls — the Capacity chip (sessions in flight of the cap,
// −/+ inside) and the Autopilot pill (dot + word; the pacing phrase and the
// full breakdown live in its Tooltip). Both are soft pills of one height.

import { Bot, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AutopilotDetails, autopilotPhrase } from '../../board/AutopilotSwitch';
import { autopilotReadout, autopilotTone } from '../../board/autopilotReadout';
import { useAutopilotStatus } from '../../board/useAutopilotStatus';
import { useCapSetting } from '../shared';

export const PILL = 'inline-flex h-8 flex-shrink-0 items-center gap-2 rounded-pill bg-secondary/35 px-3 typo-caption text-foreground';

const STEP = 'focus-ring inline-flex h-6 w-6 items-center justify-center rounded-pill text-foreground opacity-70 transition-colors hover:bg-secondary/60 hover:opacity-100 disabled:opacity-25';

export function CapacityChip({ inFlight, overAdmitted, simulated }: { inFlight: number; overAdmitted: number; simulated: boolean }) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const cap = useCapSetting(simulated);
  const over = overAdmitted > 0;
  const hint = over
    ? tx(s.queue_cap_over_hint, { running: inFlight, cap: cap.cap, over: overAdmitted })
    : tx(s.queue_cap_hint, { running: inFlight, cap: cap.cap });
  return (
    <Tooltip content={hint}>
      <div
        role="group"
        aria-label={s.queue_cap_aria}
        data-testid="fleet-max-parallel"
        data-over={over || undefined}
        className={`${PILL} gap-1 pl-3 pr-1 ${over ? 'bg-status-warning/15' : ''}`}
      >
        <span className="opacity-70">Capacity</span>
        <span className={`px-1 typo-data tabular-nums ${over ? 'text-status-warning' : 'text-foreground'}`} data-testid="fleet-max-parallel-readout">
          <Numeric value={inFlight} /> <span className="opacity-60">of</span> <Numeric value={cap.cap} />
        </span>
        <button type="button" className={STEP} onClick={cap.decrease} disabled={!cap.canDecrease} aria-label={s.queue_cap_decrease}>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" className={STEP} onClick={cap.increase} disabled={!cap.canIncrease} aria-label={s.queue_cap_increase}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </Tooltip>
  );
}

const TONE_DOT = {
  off: 'bg-foreground/30',
  stopped: 'bg-status-error',
  holding: 'bg-status-warning',
  running: 'bg-status-success',
} as const;

export function AutopilotPill() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { status, failed, saving, toggle } = useAutopilotStatus();
  const readout = status ? autopilotReadout(status) : null;
  const tone = readout ? autopilotTone(readout) : 'off';
  const text = readout ? autopilotPhrase(readout, m, tx) : failed ? m.autopilot_unavailable : null;
  const on = status?.enabled ?? false;
  const tip = (
    <div className="flex max-w-xs flex-col gap-1 typo-caption">
      <span className="typo-title">{m.autopilot} · {on ? t.common.active : t.common.off}</span>
      {text && <span className="tabular-nums">{text}</span>}
      {status && <AutopilotDetails status={status} />}
    </div>
  );
  return (
    <Tooltip content={tip}>
      <span className="inline-flex flex-shrink-0" data-testid="fleet-autopilot" data-autopilot={status ? (on ? 'on' : 'off') : 'unknown'}>
        <AsyncButton
          variant="ghost"
          size="sm"
          aria-label={m.autopilot_aria}
          aria-pressed={on}
          isLoading={saving}
          disabled={!status}
          onClick={() => toggle().catch(toastCatch('fleet/atelier:autopilot', m.autopilot_toggle_failed))}
          className={`${PILL} hover:bg-secondary/55 ${on ? 'bg-status-success/10' : ''}`}
          icon={<Bot className="h-4 w-4" aria-hidden />}
          data-testid="fleet-autopilot-toggle"
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
          {m.autopilot}
        </AsyncButton>
      </span>
    </Tooltip>
  );
}
