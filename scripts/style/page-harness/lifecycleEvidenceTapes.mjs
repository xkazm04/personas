// Synthetic tape for Lifecycle excellence wave 8: the evidence steps telling
// the story of the practice (lifecycleSurfaces.tsx). Built ON the WP4 detail
// tape (lifecycleDetailTapes.mjs, the `detail` builder, unchanged) with ONE
// history of 64 changes, newest first, one every 21 hours (about eight
// weeks), each carrying an outcome for every evidence step:
//
// - Land below its target: commits skip it (pushed straight to main at a sha,
//   or merged locally), tasks keep it, pull requests always do; a few skips
//   left no note, one merge failed;
// - Commit healthy with one dip week (days 14-20 back, --no-verify skips);
// - Isolate, Sync and Record mostly done, each with its own skip note.
//
// Each step's detail is that history reduced to its own outcome (as
// detail.rs project_step ships it); the snapshot's evidence is the newest 20
// with every step's outcome, and the evidence steps' verdicts, tallies and
// earlier windows are derived from that window the way health.rs derives them
// (done / (done + skipped + failed), 5 changes before a verdict, green at 80%,
// at risk from 50%). Fixture CODE, no personal data. Mirrors
// journey/__tests__/evidenceFixtures.ts.
//
//   plugins/lifecycle/evidence   open a step with --steps "click=[data-testid=lc-node-land];wait=600"
import { lifecycleDetailTapes } from './lifecycleDetailTapes.mjs';

export function lifecycleEvidenceTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const HOUR = 3_600_000;
  const base = lifecycleDetailTapes({ RECORDED_AT }).builders['plugins/lifecycle/detail'];
  const COUNT = 64;
  const SPACING_H = 21;
  const WINDOW = 20;
  const STEPS = ['isolate', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record'];
  const EVIDENCE_STEPS = ['isolate', 'sync', 'commit', 'land', 'record'];

  const kindOf = (i) => (i % 10 === 4 ? 'pr' : i % 3 === 0 ? 'task' : 'commit');
  const shaOf = (i) => (0xabc1230 + i * 977).toString(16);
  const TITLES = [
    'Rename the vault store', 'Add the fleet grid filters', 'Fix the agent editor focus trap', 'Tidy the home page',
    'Stream run output into the log view', 'Retry the Sentry upload', 'Split the overview metrics query',
    'Cache the connector catalog', 'Translate the triggers page', 'Guard the schedule editor against overlap',
    'Measure the gate in parallel', 'Drop the legacy recipe importer', 'Show cost per persona', 'Speed up the docs scan',
  ];

  function outcomes(i, at) {
    const kind = kindOf(i);
    const daysBack = (T0 - at) / (24 * HOUR);
    const o = {};
    // Land
    if (kind === 'pr') o.land = ['done', null];
    else if (kind === 'task') o.land = i % 18 === 0 ? ['skipped', 'No reviewer was available'] : ['done', null];
    else if (i % 7 === 1) o.land = ['done', null];
    else if (i === 5) o.land = ['failed', 'The merge was reverted'];
    else o.land = ['skipped', i % 13 === 2 ? null : i % 4 === 0 ? 'Merged locally; the pull request was never opened' : `Pushed straight to main at ${shaOf(i)}`];
    // Commit, one dip week
    const dip = daysBack >= 14 && daysBack < 21;
    o.commit = dip && i % 2 === 0
      ? ['skipped', 'Committed with --no-verify; the hook was skipped']
      : i % 17 === 9 ? ['skipped', 'Amended after the hook ran'] : ['done', null];
    o.isolate = i % 11 === 6 ? ['skipped', 'Worked on the main checkout'] : ['done', null];
    o.sync = i % 6 === 2 ? ['skipped', 'Rebased after the gate ran'] : ['done', null];
    o.record = i % 23 === 11 ? ['unknown', null] : ['done', null];
    o.gate = i === 2 ? ['failed', 'eslint failed on VaultPage.tsx'] : ['done', null];
    o.tests = i % 5 === 1 ? ['skipped', null] : ['done', null];
    o.docs = i % 4 === 3 ? ['skipped', null] : ['done', null];
    return STEPS.map((stepId) => ({ stepId, outcome: o[stepId][0], detail: o[stepId][1] }));
  }

  const HISTORY = Array.from({ length: COUNT }, (_, i) => {
    const at = T0 - (i + 1) * SPACING_H * HOUR;
    const kind = kindOf(i);
    return {
      sourceKind: kind,
      sourceRef: kind === 'commit' ? `${shaOf(i)}${String(i).padStart(2, '0')}` : kind === 'pr' ? String(512 - i) : `task-${400 - i}`,
      title: TITLES[i % TITLES.length],
      occurredAt: new Date(at).toISOString(),
      outcomes: outcomes(i, at),
    };
  });
  const project = (stepId) => HISTORY.map((h) => ({ ...h, outcomes: h.outcomes.filter((o) => o.stepId === stepId) }));

  // health.rs evidence_step over a window.
  function judge(window, stepId) {
    const t = { done: 0, skipped: 0, unknown: 0, failed: 0 };
    for (const h of window) {
      const o = h.outcomes.find((x) => x.stepId === stepId);
      if (o) t[o.outcome] += 1;
    }
    const n = t.done + t.skipped + t.failed;
    const rate = n > 0 ? Math.round((t.done * 1000) / n) / 10 : null;
    const health = n < 5 ? 'unmeasured' : rate >= 80 ? 'green' : rate >= 50 ? 'amber' : 'red';
    const reason = n < 5 ? `Only ${n} changes recorded; 5 are needed` : health === 'green' ? null : `Done in ${Math.round(rate)}% of recent changes, 80% needed`;
    return { t, health, reason, metrics: [{ key: 'done_rate', value: rate, samples: n }] };
  }

  function build() {
    const tape = base();
    tape.module = 'plugins/lifecycle/evidence';
    tape.note = 'Synthetic: the detail tape with one 64-change history (about eight weeks): Land below target with clear skip reasons, Commit healthy with a dip week, every evidence step derived from the same window.';
    const snap = tape.calls.find((c) => c.cmd === 'dev_tools_get_lifecycle').response;
    const window = HISTORY.slice(0, WINDOW);
    const earlier = HISTORY.slice(1, WINDOW + 1);
    snap.evidence = window;
    snap.steps = snap.steps.map((s) => (EVIDENCE_STEPS.includes(s.step.id) ? { ...s, evidence: judge(window, s.step.id).t } : s));
    snap.health = snap.health.map((h) => {
      if (!EVIDENCE_STEPS.includes(h.stepId)) return h;
      const now = judge(window, h.stepId);
      const was = judge(earlier, h.stepId);
      return {
        ...h, health: now.health, staleOf: null, reason: now.reason, metrics: now.metrics, measuredAt: null, headSha: null,
        previous: { health: was.health, metrics: was.metrics, measuredAt: earlier[0].occurredAt, headSha: null },
      };
    });
    for (const stepId of EVIDENCE_STEPS) {
      const prior = tape.calls.find((c) => c.cmd === 'dev_tools_lifecycle_step_detail' && c.args?.stepId === stepId)?.response;
      tape.calls.push({
        cmd: 'dev_tools_lifecycle_step_detail',
        args: { projectId: snap.projectId, stepId },
        response: { stepId, runs: [], docs: [], related: prior?.related ?? [], evidence: project(stepId) },
      });
    }
    return tape;
  }

  return { HISTORY, builders: { 'plugins/lifecycle/evidence': build } };
}
