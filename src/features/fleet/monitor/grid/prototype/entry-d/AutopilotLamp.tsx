// Autopilot, as the room's master switch: a lamp that is its state and the
// readout phrase beside it, so "why is nothing starting" is answered on the
// band rather than behind a hover. The full gauges stay in the tooltip.

import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AsyncButton } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { autopilotReadout, autopilotTone } from '../../board/autopilotReadout';
import { useAutopilotStatus } from '../../board/useAutopilotStatus';
import { AutopilotDetails, autopilotPhrase } from '../../board/AutopilotSwitch';

const LAMP = { off: 'idle', running: 'done', holding: 'attention', stopped: 'failed' } as const;
const INK = {
  off: 'text-foreground',
  running: 'text-status-success',
  holding: 'text-status-warning',
  stopped: 'text-status-error',
} as const;

export function AutopilotLamp() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { status, failed, saving, toggle } = useAutopilotStatus();
  const readout = status ? autopilotReadout(status) : null;
  const tone = readout ? autopilotTone(readout) : 'off';
  const phrase = readout ? autopilotPhrase(readout, m, tx) : failed ? m.autopilot_unavailable : null;
  const on = status?.enabled ?? false;

  const tip = (
    <div className="flex max-w-xs flex-col gap-1 typo-caption">
      <span className="text-foreground">{m.autopilot} · {on ? t.common.active : t.common.off}</span>
      <span>{m.autopilot_aria}</span>
      {phrase && <span className="tabular-nums">{phrase}</span>}
      {status && <AutopilotDetails status={status} />}
    </div>
  );

  return (
    <Tooltip content={tip}>
      <span
        className="inline-flex min-w-0 flex-shrink items-center"
        data-testid="fleet-autopilot"
        data-autopilot={status ? (on ? 'on' : 'off') : 'unknown'}
      >
        <AsyncButton
          variant="ghost"
          size="sm"
          aria-label={m.autopilot_aria}
          aria-pressed={on}
          isLoading={saving}
          disabled={!status}
          onClick={() => toggle().catch(toastCatch('fleet/entry-d:autopilot', m.autopilot_toggle_failed))}
          data-testid="fleet-autopilot-toggle"
          className={`max-w-[15rem] ${INK[tone]}`}
          icon={<Bot className="h-4 w-4" aria-hidden />}
        >
          <span aria-hidden data-lamp={LAMP[tone]} className="ed-lamp" />
          <span className="ed-hide-md min-w-0 truncate typo-caption">{phrase ?? m.autopilot}</span>
        </AsyncButton>
      </span>
    </Tooltip>
  );
}
