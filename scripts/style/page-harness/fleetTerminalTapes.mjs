// Synthetic tapes for the session terminal modal (fleetTerminalSurfaces.tsx).
// Fixture CODE, no personal data.

export function fleetTerminalTapes({ RECORDED_AT }) {
  const RECAP = {
    awaySummary: null,
    lastAssistantText:
      'I drafted the 1.2 release notes from the merged PRs and grouped them by area. Two entries need your call: whether the vault migration counts as breaking, and whether to mention the new Server control page now or in 1.3. Which do you want?',
  };
  const tape = (module, note, extra) => ({
    version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
    calls: [{ cmd: 'fleet_session_recap', response: RECAP }, ...extra],
  });
  return {
    builders: {
      'fleet/terminal/sleeping': () => tape('fleet/terminal/sleeping', 'Synthetic: a dozing interactive session after an app restart.', []),
      'fleet/terminal/wake-failed': () => tape('fleet/terminal/wake-failed', 'Synthetic: the same session; Wake is refused by the registry.', [
        { cmd: 'fleet_wake_session', error: 'session not resumable: fs-sleeper' },
      ]),
    },
  };
}
