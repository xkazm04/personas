// Departures · DeparturesAutopilot — the Autopilot switch as a line of text.
// PROTOTYPE (variant C).
//
//   AUTOPILOT · OFF — 3 eligible
//
// Same hook, readout and tooltip as `AutopilotSwitch`; only the dressing differs.
// The state word takes the readout's tone (running / holding / stopped / off),
// and the whole phrase is the button — an action, so AsyncButton owns the busy.

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AsyncButton } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { autopilotReadout, autopilotTone } from '../../board/autopilotReadout';
import { useAutopilotStatus } from '../../board/useAutopilotStatus';
import { AutopilotDetails, autopilotPhrase } from '../../board/AutopilotSwitch';

const TONE: Record<ReturnType<typeof autopilotTone>, string> = {
  off: 'text-foreground opacity-60',
  stopped: 'text-status-error',
  holding: 'text-status-warning',
  running: 'text-status-success',
};

export function DeparturesAutopilot() {
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
      <span className="inline-flex flex-shrink-0" data-testid="fleet-autopilot" data-autopilot={status ? (on ? 'on' : 'off') : 'unknown'}>
        <AsyncButton
          variant="ghost"
          size="xs"
          aria-label={m.autopilot_aria}
          aria-pressed={on}
          isLoading={saving}
          disabled={!status}
          onClick={() => toggle().catch(toastCatch('fleet/DeparturesAutopilot:toggle', m.autopilot_toggle_failed))}
          data-testid="fleet-autopilot-toggle"
          className="gap-1.5"
        >
          <span className="typo-label uppercase tracking-wide text-foreground">{m.autopilot}</span>
          <span aria-hidden className="text-foreground opacity-40">·</span>
          <span className={`typo-label uppercase tracking-wide ${TONE[tone]}`}>{on ? t.common.active : t.common.off}</span>
          {phrase && (
            <span className="hidden max-w-[16rem] truncate typo-caption text-foreground opacity-60 2xl:inline">— {phrase}</span>
          )}
        </AsyncButton>
      </span>
    </Tooltip>
  );
}
