// Fleet Autopilot — the Activity board's switch over the attention loop.
//
// The switch itself is the `autonomous_attention_loop` setting (the same one
// Mission Control's AttentionLoopCard flips); `fleet_autopilot_status` is the
// one read that returns the switch, the pacing verdict (seven-day debt,
// five-hour headroom, memory room, slots), the quota governor's stop, the
// running-work headroom and every persona's autonomy standing. The tick and
// this read share one Rust module, so the board never shows a number the loop
// would not act on.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { setAppSetting } from '@/api/system/settings';
import type { AutopilotStatus } from '@/lib/bindings/AutopilotStatus';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';

/** `settings_keys::AUTONOMOUS_ATTENTION_LOOP` — boolean-validated, default off. */
export const AUTOPILOT_SWITCH_KEY = 'autonomous_attention_loop';

export const fleetAutopilotStatus = () => invoke<AutopilotStatus>('fleet_autopilot_status');

/** Flip the switch. Enabling records nothing else: the next attention tick
 *  (within five minutes, or seconds when a persona is switched on) reads the
 *  setting and plans against the live pacing. */
export const setFleetAutopilot = (enabled: boolean) =>
  setAppSetting(AUTOPILOT_SWITCH_KEY, enabled ? 'true' : 'false');

/** The next tick as the loop would plan it now — nothing spent, opened or
 *  enqueued. Rows arrive in the order the loop will walk. */
export const fleetDispatchPreview = () => invoke<DispatchPreviewView>('fleet_dispatch_preview');

/** Write the operator's global dispatch order, first to last. The next tick
 *  walks ranked personas in this order before any unranked one. An empty list
 *  ranks nobody (pure least-recently-served). Returns the list as stored. */
export const setFleetDispatchOrder = (personaIds: readonly string[]) =>
  invoke<string[]>('fleet_dispatch_order_set', { personaIds: [...personaIds] });
