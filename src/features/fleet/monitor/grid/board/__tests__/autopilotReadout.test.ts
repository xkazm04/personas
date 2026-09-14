import { describe, expect, it } from 'vitest';
import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';
import { autopilotReadout, autopilotTone } from '../autopilotReadout';

function status(over: Partial<AutopilotStatus> = {}, pacing: Partial<AutopilotStatus['pacing']> = {}): AutopilotStatus {
  return {
    enabled: true,
    pacing: {
      pacingEnabled: true,
      parallelCap: 3,
      slots: 2,
      hold: null,
      weeklyTargetPct: 90,
      weeklyElapsedPct: 50,
      weeklyLinearPct: 45,
      sevenDayPct: 33,
      behindPct: 12.4,
      fiveHourPct: 40,
      fiveHourLinePct: 87,
      usageSlots: 3,
      memoryUsedPct: 55,
      memoryTotalMb: 32768,
      memoryStopPct: 75,
      memoryPerAgentMb: 1500,
      memorySlots: 4,
      usageAvailable: true,
      usageReason: null,
      ...pacing,
    },
    governor: {
      blocked: false,
      stopPct: 97,
      worstKey: 'seven_day',
      worstPct: 33,
      resetsInMinutes: 4000,
      minutesToStop: null,
      unavailableReason: null,
    },
    headroom: { running: 1, cap: 10 },
    personas: [],
    eligibleCount: 4,
    dispatchedToday: 7,
    ...over,
  };
}

describe('autopilotReadout — one phrase, by precedence', () => {
  it('off shows how many personas would qualify', () => {
    const r = autopilotReadout(status({ enabled: false }));
    expect(r).toEqual({ kind: 'off', eligible: 4 });
    expect(autopilotTone(r)).toBe('off');
  });

  it("the governor's stop outranks everything while on", () => {
    const s = status({ governor: { ...status().governor, blocked: true, worstPct: 98.4 } }, { hold: 'ahead_of_pace', slots: 0 });
    const r = autopilotReadout(s);
    expect(r).toEqual({ kind: 'quota_stop', window: 'seven_day', pct: 98 });
    expect(autopilotTone(r)).toBe('stopped');
  });

  it('a pacing hold outranks the slot count', () => {
    expect(autopilotReadout(status({}, { hold: 'ahead_of_pace', slots: 0 }))).toEqual({ kind: 'hold_ahead' });
    expect(autopilotReadout(status({}, { hold: 'five_hour_full', slots: 0 }))).toEqual({ kind: 'hold_five_hour' });
    const mem = autopilotReadout(status({}, { hold: 'memory_full', slots: 0 }));
    expect(mem).toEqual({ kind: 'hold_memory' });
    expect(autopilotTone(mem)).toBe('holding');
  });

  it('open slots carry the rounded standing against pace', () => {
    const r = autopilotReadout(status());
    expect(r).toEqual({ kind: 'slots', slots: 2, cap: 3, behind: 12 });
    expect(autopilotTone(r)).toBe('running');
  });

  it('an unreadable gauge leaves the standing out rather than inventing zero', () => {
    const r = autopilotReadout(status({}, { behindPct: null, usageAvailable: false }));
    expect(r).toEqual({ kind: 'slots', slots: 2, cap: 3, behind: null });
  });

  it('off is decided before the governor: a stopped loop that is switched off reads off', () => {
    const s = status({ enabled: false, governor: { ...status().governor, blocked: true } });
    expect(autopilotReadout(s).kind).toBe('off');
  });
});
