// InstrumentAutopilot — the attention loop's switch as an annunciator: the
// label, the loop's own phrase in mono beside it, and a top edge lit in the
// verdict's hue (running / holding / stopped). The full pacing readout is the
// tooltip, as on the baseline switch.

import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AsyncButton } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { autopilotReadout, autopilotTone } from '../../board/autopilotReadout';
import { useAutopilotStatus } from '../../board/useAutopilotStatus';
import { AutopilotDetails, autopilotPhrase } from '../../board/AutopilotSwitch';

const EDGE = { off: 'bg-foreground/20', stopped: 'bg-status-error', holding: 'bg-status-warning', running: 'bg-status-success' } as const;
const TEXT = { off: 'text-foreground', stopped: 'text-status-error', holding: 'text-status-warning', running: 'text-status-success' } as const;

export function InstrumentAutopilot() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { status, failed, saving, toggle } = useAutopilotStatus();
  const readout = status ? autopilotReadout(status) : null;
  const tone = readout ? autopilotTone(readout) : 'off';
  const phrase = readout ? autopilotPhrase(readout, m, tx) : failed ? m.autopilot_unavailable : null;
  const on = status?.enabled ?? false;

  const tip = (
    <div className="flex max-w-xs flex-col gap-1 typo-caption">
      <span className="font-medium">{m.autopilot} · {on ? t.common.active : t.common.off}</span>
      <span className="opacity-80">{m.autopilot_aria}</span>
      {status && <AutopilotDetails status={status} />}
    </div>
  );

  return (
    <Tooltip content={tip}>
      <span className="relative inline-flex" data-testid="fleet-autopilot" data-autopilot={status ? (on ? 'on' : 'off') : 'unknown'}>
        <span aria-hidden className={`absolute inset-x-1 top-0 h-0.5 rounded-pill ${EDGE[tone]}`} />
        <AsyncButton
          variant="ghost"
          size="sm"
          aria-label={m.autopilot_aria}
          aria-pressed={on}
          isLoading={saving}
          disabled={!status}
          onClick={() => toggle().catch(toastCatch('fleet/InstrumentAutopilot:toggle', m.autopilot_toggle_failed))}
          icon={<Bot className={`h-4 w-4 ${TEXT[tone]}`} aria-hidden />}
          className="border border-primary/10 bg-foreground/[0.02]"
          data-testid="fleet-autopilot-toggle"
        >
          <span className="flex flex-col items-start leading-tight">
            <span className="typo-label uppercase tracking-wider text-foreground">{m.autopilot}</span>
            {phrase && <span className={`max-w-[14rem] truncate typo-code ${TEXT[tone]}`}>{phrase}</span>}
          </span>
        </AsyncButton>
      </span>
    </Tooltip>
  );
}
