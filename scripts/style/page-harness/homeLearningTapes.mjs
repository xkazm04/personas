// Synthetic tapes for Home > Learning (kit batch home-1; homeLearningSurfaces.tsx). The page
// makes two IPC calls: `companion_list_composed_tours` (ComposedTourRecord rows; stepsJson is
// re-validated against tourAnchorManifest.json, so the ready rows use sections and anchors the
// manifest declares) and the event-chain power move's probe, `list_all_triggers`.
// Fixture CODE, no personal data.

export function homeLearningTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const isoAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  const step = (id, title, description, sidebarSection) => ({ id, title, description, hint: '', nav: { sidebarSection } });
  const record = (id, title, topic, steps, status, minutesAgo) => ({
    id, topic, title, description: `A walkthrough of ${topic}.`, icon: 'Sparkles', color: 'violet',
    stepsJson: JSON.stringify(steps), status, createdAt: isoAgo(minutesAgo),
  });

  const COMPOSED = [
    record('athena-credential-rotation', 'Rotate a credential without downtime', 'credential rotation', [
      step('c1', 'Open the vault', 'Every credential your agents use lives here.', 'credentials'),
      step('c2', 'Check its health', 'A failing credential shows its last error and when it was tested.', 'credentials'),
      step('c3', 'Watch the next run', 'The run that follows uses the new secret.', 'overview'),
    ], 'ready', 60 * 5),
    record('athena-event-chains', 'Chain two agents with an event', 'event chains', [
      step('e1', 'Open the event bus', 'Events connect agents without a schedule.', 'events'),
      step('e2', 'Pick a listener', 'A listener starts an agent when another one finishes.', 'events'),
      step('e3', 'See it fire', 'The live stream shows each hop as it happens.', 'events'),
      step('e4', 'Review the runs', 'Both runs land in the execution list.', 'overview'),
    ], 'ready', 60 * 30),
    record('athena-old-dashboard', 'Tour the old metrics dashboard', 'metrics dashboard', [
      step('o1', 'Open the dashboard', 'The dashboard this tour was written for has moved.', 'overview'),
    ], 'stale', 60 * 24 * 12),
  ];

  const base = (module, note, composed) => ({
    version: 1,
    module,
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note,
    calls: [
      composed,
      { cmd: 'list_all_triggers', response: [] },
    ],
  });
  const ok = { cmd: 'companion_list_composed_tours', response: COMPOSED };

  return {
    builders: {
      'home/learning': () => base('home/learning', 'Synthetic: 3 of 9 tours done, 1 in progress, 2 ready composed tours and 1 stale, 4 moves used.', ok),
      'home/learning/fresh': () => base('home/learning/fresh', 'Synthetic: first run, no progress, no composed tours.', { cmd: 'companion_list_composed_tours', response: [] }),
      'home/learning/failed': () => base('home/learning/failed', 'Synthetic: the composed-tours fetch rejects.', { cmd: 'companion_list_composed_tours', error: 'companion_list_composed_tours failed (page harness)' }),
      'home/learning/tour': () => base('home/learning/tour', 'Synthetic: the returning user with the in-progress tour detail open.', ok),
    },
  };
}
