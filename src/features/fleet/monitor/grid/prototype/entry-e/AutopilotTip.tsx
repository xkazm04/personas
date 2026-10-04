// The Autopilot READING — the panel behind the switch.
//
// Autopilot is the one control on the supply column whose state is a chain of
// reasoning rather than a value: three gauges, a headroom, a roster test and a
// precedence over which of them is currently the reason nothing is starting.
// The baseline poured all of it into a `max-w-xs` stack of sentences, which is
// the longest tooltip in the app and the least readable — six lines of prose
// at 320px, every number buried mid-sentence.
//
// Here it is a WIDE instrument panel (the tooltip's own 480px ceiling, used):
// each gauge is the Annunciator's own segment strip with the governing line
// drawn on it as a notch, so "5-hour at 71%, workers start below 80%" is a bar
// with a mark you read in one look, and the sentence beside it is the
// evidence, not the message. No new strings: every line is the `autopilot_*`
// copy the switch already shipped, laid out instead of stacked.
//
// INERT BY CONTRACT — a tooltip may not hold anything focusable or clickable
// (`display/Tooltip`, golden path P7). Everything below is text and paint.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Boxes, CalendarRange, Timer, Users, Zap } from 'lucide-react';
import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';
import { useTranslation } from '@/i18n/useTranslation';
import { Lamp, Segments } from './parts';
import type { Tone } from './tone';

const MAX_NAMES = 6;
const GAUGE_SEGS = 12;

/** A gauge against its own line: calm below it, amber at it, red past the
 *  stop. The same three-step reading the usage strips use. */
function gaugeTone(pct: number, line: number): Tone {
  if (pct >= Math.max(line, 1) * 1.15) return 'err';
  if (pct >= line) return 'warn';
  return 'ok';
}

function Gauge({
  icon: Icon, pct, line, children,
}: { icon: LucideIcon; pct: number; line: number; children: string }) {
  const tone = gaugeTone(pct, line);
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <Segments
        className="w-16 flex-shrink-0"
        count={GAUGE_SEGS}
        lit={(Math.max(0, Math.min(100, pct)) / 100) * GAUGE_SEGS}
        tone={tone}
        thin
        mark={(Math.max(0, Math.min(100, line)) / 100) * GAUGE_SEGS}
      />
      <span className="min-w-0 flex-1 tabular-nums">{children}</span>
    </div>
  );
}

/** One fact with its glyph, where there is no gauge to draw. */
function Note({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function AutopilotTip({
  status, failed, on, phrase, tone,
}: {
  status: AutopilotStatus | null;
  failed: boolean;
  on: boolean;
  /** The switch's one-phrase verdict — the headline of this panel. */
  phrase: string | null;
  tone: Tone;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const p = status?.pacing ?? null;
  const eligible = status?.personas.filter((x) => x.eligible) ?? [];
  const names = eligible.slice(0, MAX_NAMES).map((x) => x.personaName).join(', ')
    + (eligible.length > MAX_NAMES ? ` +${eligible.length - MAX_NAMES}` : '');

  return (
    <div className="flex w-[25rem] max-w-full flex-col gap-2 typo-caption">
      <div className="flex items-center gap-2">
        <Lamp lamp={{ tone, lit: on }} />
        <span className="typo-label text-foreground">{m.autopilot}</span>
        <span className="text-foreground">· {on ? t.common.active : t.common.off}</span>
        {phrase && <span className="ml-auto tabular-nums text-foreground">{phrase}</span>}
      </div>
      <p className="border-b border-foreground/10 pb-2">{m.autopilot_aria}</p>

      {!status ? (
        <p>{failed ? m.autopilot_unavailable : ''}</p>
      ) : (
        <>
          {p && (p.usageAvailable ? (
            <>
              <Gauge icon={CalendarRange} pct={p.sevenDayPct ?? 0} line={p.weeklyLinearPct}>
                {tx(m.autopilot_detail_week, {
                  actual: Math.round(p.sevenDayPct ?? 0),
                  pace: Math.round(p.weeklyLinearPct),
                  target: Math.round(p.weeklyTargetPct),
                })}
              </Gauge>
              <Gauge icon={Timer} pct={p.fiveHourPct ?? 0} line={p.fiveHourLinePct}>
                {tx(m.autopilot_detail_five_hour, {
                  actual: Math.round(p.fiveHourPct ?? 0),
                  line: Math.round(p.fiveHourLinePct),
                })}
              </Gauge>
            </>
          ) : (
            <Note icon={Timer}>{tx(m.autopilot_detail_usage_unreadable, { reason: p.usageReason ?? '' })}</Note>
          ))}
          {p && (
            <Gauge icon={Boxes} pct={p.memoryUsedPct} line={p.memoryStopPct}>
              {tx(m.autopilot_detail_memory, {
                used: Math.round(p.memoryUsedPct),
                total: Math.round(p.memoryTotalMb / 1024),
                stop: Math.round(p.memoryStopPct),
                slots: p.memorySlots,
              })}
            </Gauge>
          )}

          <div className="flex flex-col gap-1.5 border-t border-foreground/10 pt-2">
            <Note icon={Zap}>
              <span className="tabular-nums">
                {tx(m.autopilot_detail_running, { running: status.headroom.running, cap: status.headroom.cap })}
                {' · '}
                {tx(m.autopilot_detail_dispatched, { count: status.dispatchedToday })}
              </span>
            </Note>
            <Note icon={Users}>
              {eligible.length > 0
                ? tx(m.autopilot_detail_eligible, { count: eligible.length, total: status.personas.length, names })
                : m.autopilot_detail_none_eligible}
            </Note>
            {p && !p.pacingEnabled && <p className="pl-[1.375rem]">{m.autopilot_detail_pacing_off}</p>}
          </div>
        </>
      )}
    </div>
  );
}
