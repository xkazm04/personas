// AutopilotSwitch — the Activity board's one switch over the attention loop.
//
// ON means: every persona with an active charter that has the attention loop
// enabled is served on the loop's tick, as many at a time as the pacing
// allows — behind the seven-day plan and with five-hour and memory headroom.
// The switch flips `autonomous_attention_loop`; the numbers beside it come
// from `fleet_autopilot_status`, the same verdicts the tick reads.
//
// One phrase next to the switch (see `autopilotReadout` for the precedence);
// the full reasoning — the three gauges, the running count, which personas
// are eligible — lives in the tooltip, where a curious operator can read it
// without the header growing a second row.

import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { toastCatch } from '@/lib/silentCatch';
import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';
import { autopilotReadout, autopilotTone, type AutopilotReadout } from './autopilotReadout';
import { useAutopilotStatus } from './useAutopilotStatus';

const TONE_CLASS: Record<ReturnType<typeof autopilotTone>, string> = {
  off: 'border-border bg-secondary/20 text-foreground',
  stopped: 'border-status-error/40 bg-status-error/10 text-status-error',
  holding: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
  running: 'border-status-success/40 bg-status-success/10 text-status-success',
};

const MAX_NAMES = 6;

function Details({ status }: { status: AutopilotStatus }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const p = status.pacing;
  const eligible = status.personas.filter((x) => x.eligible);
  const names = eligible.slice(0, MAX_NAMES).map((x) => x.personaName).join(', ')
    + (eligible.length > MAX_NAMES ? ` +${eligible.length - MAX_NAMES}` : '');

  return (
    <div className="flex max-w-xs flex-col gap-1 typo-caption">
      {p.usageAvailable ? (
        <>
          <span>
            {tx(m.autopilot_detail_week, {
              actual: Math.round(p.sevenDayPct ?? 0),
              pace: Math.round(p.weeklyLinearPct),
              target: Math.round(p.weeklyTargetPct),
            })}
          </span>
          <span>
            {tx(m.autopilot_detail_five_hour, {
              actual: Math.round(p.fiveHourPct ?? 0),
              line: Math.round(p.fiveHourLinePct),
            })}
          </span>
        </>
      ) : (
        <span>{tx(m.autopilot_detail_usage_unreadable, { reason: p.usageReason ?? '' })}</span>
      )}
      <span>
        {tx(m.autopilot_detail_memory, {
          used: Math.round(p.memoryUsedPct),
          total: Math.round(p.memoryTotalMb / 1024),
          stop: Math.round(p.memoryStopPct),
          slots: p.memorySlots,
        })}
      </span>
      <span>
        {tx(m.autopilot_detail_running, { running: status.headroom.running, cap: status.headroom.cap })}
        {' · '}
        {tx(m.autopilot_detail_dispatched, { count: status.dispatchedToday })}
      </span>
      {eligible.length > 0 ? (
        <span>
          {tx(m.autopilot_detail_eligible, {
            count: eligible.length,
            total: status.personas.length,
            names,
          })}
        </span>
      ) : (
        <span>{m.autopilot_detail_none_eligible}</span>
      )}
      {!p.pacingEnabled && <span className="opacity-70">{m.autopilot_detail_pacing_off}</span>}
    </div>
  );
}

function phrase(
  r: AutopilotReadout,
  m: ReturnType<typeof useTranslation>['t']['monitor'],
  tx: ReturnType<typeof useTranslation>['tx'],
): string {
  switch (r.kind) {
    case 'off':
      return tx(m.autopilot_eligible, { count: r.eligible });
    case 'quota_stop':
      return tx(m.autopilot_quota_stop, { window: r.window, pct: r.pct });
    case 'hold_ahead':
      return m.autopilot_hold_ahead;
    case 'hold_five_hour':
      return m.autopilot_hold_five_hour;
    case 'hold_memory':
      return m.autopilot_hold_memory;
    case 'slots': {
      const slots = tx(m.autopilot_slots, { slots: r.slots, cap: r.cap });
      if (r.behind == null) return slots;
      const pace = r.behind >= 0
        ? tx(m.autopilot_behind, { pts: r.behind })
        : tx(m.autopilot_ahead, { pts: -r.behind });
      return `${slots} · ${pace}`;
    }
  }
}

export function AutopilotSwitch() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { status, failed, saving, toggle } = useAutopilotStatus();

  const onToggle = () => {
    toggle().catch(toastCatch('fleet/AutopilotSwitch:toggle', m.autopilot_toggle_failed));
  };

  const readout = status ? autopilotReadout(status) : null;
  const tone = readout ? autopilotTone(readout) : 'off';
  const text = readout ? phrase(readout, m, tx) : failed ? m.autopilot_unavailable : null;

  const pill = (
    <span
      className={`inline-flex h-6 flex-shrink-0 items-center gap-1.5 rounded-full border px-2 typo-caption transition-colors ${TONE_CLASS[tone]}`}
      data-testid="fleet-autopilot"
      data-autopilot={status ? (status.enabled ? 'on' : 'off') : 'unknown'}
    >
      <Bot className="h-3 w-3 flex-shrink-0" aria-hidden />
      <span className="font-medium">{m.autopilot}</span>
      <AccessibleToggle
        size="sm"
        checked={status?.enabled ?? false}
        onChange={onToggle}
        label={m.autopilot_aria}
        disabled={saving || !status}
        data-testid="fleet-autopilot-toggle"
      />
      {text && <span className="tabular-nums opacity-80">{text}</span>}
    </span>
  );

  if (!status) return pill;
  return <Tooltip content={<Details status={status} />}>{pill}</Tooltip>;
}

export default AutopilotSwitch;
