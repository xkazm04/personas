/**
 * The Persona Monitor's session terminal modal (`FleetTerminalModal`) in the
 * states that have no terminal, on the tapes in `fleetTerminalTapes.mjs`.
 *
 *   fleet/terminal/sleeping      a dozing session after an app restart: why it
 *                                sleeps, its last words, Wake in the footer
 *   fleet/terminal/wake-failed   the same row after Wake was refused: the
 *                                refusal in the modal, Kill session enabled
 *
 * The row is seeded into the fleet store in `prepare`; the wake-failed variant
 * presses the real Wake button once it exists.
 */
import { useEffect } from 'react';

import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const T0 = Date.parse('2026-10-06T09:30:00.000Z');

// A fixture, not a wire payload: the fields the modal reads are real.
const SLEEPER = {
  id: 'fs-sleeper', claudeSessionId: 'cc-sleeper', name: 'Release notes for 1.2', title: null,
  projectLabel: 'personas', cwd: 'C:\\dev\\personas', state: 'awaiting_input', mode: 'interactive', dozing: true,
  stateReason: 'Recovered after an app restart - its live connection was lost',
  lastActivityMs: BigInt(T0 - 47 * 60_000), createdAtMs: BigInt(T0 - 3 * 3_600_000), origin: 'operator',
} as unknown as FleetSession;

function prepare(): void {
  useSystemStore.setState({ fleetSessions: [SLEEPER], fleetRefresh: async () => {} });
}

function Host({ pressWake }: { pressWake: boolean }) {
  useEffect(() => {
    if (!pressWake) return;
    let tries = 0;
    const tick = () => {
      const btn = document.querySelector<HTMLButtonElement>('[data-testid="fleet-terminal-wake"]');
      if (btn) btn.click();
      else if (tries++ < 100) setTimeout(tick, 50);
    };
    tick();
  }, [pressWake]);
  return null;
}

function module(pressWake: boolean): HarnessModule {
  return {
    load: async () => {
      const { FleetTerminalModal } = await import('@/features/fleet/monitor/grid/FleetTerminalModal');
      return { default: () => (<><FleetTerminalModal session={SLEEPER} onClose={() => {}} /><Host pressWake={pressWake} /></>) };
    },
    prepare,
  };
}

export const FLEET_TERMINAL_MODULES: Record<string, HarnessModule> = {
  'fleet/terminal/sleeping': module(false),
  'fleet/terminal/wake-failed': module(true),
};
