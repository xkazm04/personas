// autopilotReadout — the switch's one-phrase state, as data.
//
// The header has room for one short phrase next to the switch. Which phrase
// wins is a fixed precedence — the governor's STOP over a pacing HOLD over
// the slot count — because each outranks the next as the reason nothing is
// starting. Pure, so the precedence is a unit test and the component only
// maps a `kind` to a translated string.

import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';

export type AutopilotReadout =
  | { kind: 'off'; eligible: number }
  | { kind: 'quota_stop'; window: string; pct: number }
  | { kind: 'hold_ahead' | 'hold_five_hour' | 'hold_memory' }
  | { kind: 'slots'; slots: number; cap: number; behind: number | null };

export function autopilotReadout(s: AutopilotStatus): AutopilotReadout {
  if (!s.enabled) return { kind: 'off', eligible: s.eligibleCount };
  if (s.governor.blocked) {
    return {
      kind: 'quota_stop',
      window: s.governor.worstKey ?? 'usage',
      pct: Math.round(s.governor.worstPct),
    };
  }
  switch (s.pacing.hold) {
    case 'ahead_of_pace':
      return { kind: 'hold_ahead' };
    case 'five_hour_full':
      return { kind: 'hold_five_hour' };
    case 'memory_full':
      return { kind: 'hold_memory' };
    default:
      return {
        kind: 'slots',
        slots: s.pacing.slots,
        cap: s.pacing.parallelCap,
        behind: s.pacing.behindPct == null ? null : Math.round(s.pacing.behindPct),
      };
  }
}

/** The tone the pill takes: the switch is a control, its colour is its state. */
export function autopilotTone(r: AutopilotReadout): 'off' | 'stopped' | 'holding' | 'running' {
  switch (r.kind) {
    case 'off':
      return 'off';
    case 'quota_stop':
      return 'stopped';
    case 'slots':
      return 'running';
    default:
      return 'holding';
  }
}
