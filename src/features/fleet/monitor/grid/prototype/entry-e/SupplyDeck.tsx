// The SUPPLY column: everything the fleet can spend, on one plate each.
//
// The cap is a rack of sockets - one per slot - lit by the sessions holding
// them, so "7 / 10" is also seven lights and three dark wells, and an
// over-admitted session is a lamp outside the rack. Autopilot says its pacing
// verdict in words under its switch instead of hiding it in a tooltip.

import { Bot, ListOrdered, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { AutopilotDetails, autopilotPhrase } from '../../board/AutopilotSwitch';
import { useAutopilotStatus } from '../../board/useAutopilotStatus';
import { autopilotReadout, autopilotTone } from '../../board/autopilotReadout';
import type { useCapSetting } from '../shared';
import type { UsageFeed } from '../useUsageFeed';
import { Engraved, Lamp } from './parts';
import { PlanPlates } from './PlanPlates';
import type { Tone } from './tone';

const AUTOPILOT_TONE: Record<ReturnType<typeof autopilotTone>, Tone> = {
  off: 'off', stopped: 'err', holding: 'warn', running: 'ok',
};

function CapRack({
  cap, running, overAdmitted,
}: { cap: ReturnType<typeof useCapSetting>; running: number; overAdmitted: number }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const over = overAdmitted > 0;
  const lit = Math.min(running, cap.cap);
  const hint = over
    ? tx(m.queue_cap_over_hint, { running, cap: cap.cap, over: overAdmitted })
    : tx(m.queue_cap_hint, { running, cap: cap.cap });

  return (
    <section className="ae-plate flex flex-col gap-2.5 rounded-card p-3" data-testid="fleet-max-parallel" data-over={over || undefined} aria-label={m.queue_cap_aria}>
      <header className="flex items-center gap-2">
        <Engraved>{t.agents.ops.sessions}</Engraved>
        {running > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />}
      </header>
      <div className="flex items-end gap-2">
        <Tooltip content={hint}>
          <span className={`typo-data-lg tabular-nums ${over ? 'text-status-warning' : 'text-foreground'}`} data-testid="fleet-max-parallel-readout">
            <Numeric value={running} /><span className="typo-data"> / <Numeric value={cap.cap} /></span>
          </span>
        </Tooltip>
        <span className="ml-auto flex items-center gap-1">
          <Tooltip content={m.queue_cap_decrease}>
            <Button variant="secondary" size="icon-sm" onClick={cap.decrease} disabled={!cap.canDecrease} aria-label={m.queue_cap_decrease} icon={<Minus className="h-3.5 w-3.5" />} />
          </Tooltip>
          <Tooltip content={m.queue_cap_increase}>
            <Button variant="secondary" size="icon-sm" onClick={cap.increase} disabled={!cap.canIncrease} aria-label={m.queue_cap_increase} icon={<Plus className="h-3.5 w-3.5" />} />
          </Tooltip>
        </span>
      </div>
      <Tooltip content={hint}>
        <div className="ae-rack ae-t-run" role="img" aria-label={hint}>
          {Array.from({ length: cap.cap }, (_, i) => <span key={i} className={`ae-socket ${i < lit ? 'on' : ''}`} />)}
        </div>
      </Tooltip>
      {over && (
        <div className="flex items-center gap-2 typo-caption text-status-warning">
          <span className="ae-rack ae-t-warn flex-1">
            {Array.from({ length: Math.min(overAdmitted, 10) }, (_, i) => <span key={i} className="ae-socket on" />)}
          </span>
          <span className="flex-shrink-0">{m.queue_over_admitted}</span>
        </div>
      )}
    </section>
  );
}

function AutopilotPlate({ onOpenOrchestration }: { onOpenOrchestration: () => void }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { status, failed, saving, toggle } = useAutopilotStatus();
  const readout = status ? autopilotReadout(status) : null;
  const tone = readout ? autopilotTone(readout) : 'off';
  const phrase = readout ? autopilotPhrase(readout, m, tx) : failed ? m.autopilot_unavailable : null;
  const on = status?.enabled ?? false;

  return (
    <section
      className="ae-plate flex flex-col gap-2 rounded-card p-3"
      data-testid="fleet-autopilot"
      data-autopilot={status ? (on ? 'on' : 'off') : 'unknown'}
    >
      <header className="flex items-center gap-2">
        <Lamp lamp={{ tone: AUTOPILOT_TONE[tone], lit: on }} />
        <Engraved>{m.autopilot}</Engraved>
        <Tooltip content={m.queue_open_orchestration}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={onOpenOrchestration}
            aria-label={m.queue_open_orchestration}
            data-testid="fleet-grid-orchestration"
            icon={<ListOrdered className="h-4 w-4" />}
          />
        </Tooltip>
      </header>
      <Tooltip
        content={
          <div className="flex max-w-xs flex-col gap-1 typo-caption">
            <span>{m.autopilot_aria}</span>
            {status && <AutopilotDetails status={status} />}
          </div>
        }
      >
        <span className="flex">
          <AsyncButton
            variant={on ? 'accent' : 'secondary'}
            tone={on ? 'success' : undefined}
            size="sm"
            block
            aria-label={m.autopilot_aria}
            aria-pressed={on}
            isLoading={saving}
            disabled={!status}
            onClick={() => toggle().catch(toastCatch('fleet/entry-e:autopilot', m.autopilot_toggle_failed))}
            icon={<Bot className="h-4 w-4" aria-hidden />}
            data-testid="fleet-autopilot-toggle"
          >
            {on ? t.common.active : t.common.off}
          </AsyncButton>
        </span>
      </Tooltip>
      {phrase && <p className="typo-caption tabular-nums" data-testid="entry-e-autopilot-phrase">{phrase}</p>}
    </section>
  );
}

export function SupplyDeck({
  cap, running, overAdmitted, usage, onOpenOrchestration,
}: {
  cap: ReturnType<typeof useCapSetting>;
  running: number;
  overAdmitted: number;
  usage: UsageFeed;
  onOpenOrchestration: () => void;
}) {
  return (
    <aside className="flex w-[264px] flex-shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2.5" data-testid="entry-e-supply">
      <CapRack cap={cap} running={running} overAdmitted={overAdmitted} />
      <AutopilotPlate onOpenOrchestration={onOpenOrchestration} />
      <PlanPlates usage={usage} />
    </aside>
  );
}
