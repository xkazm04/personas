import { describe, expect, it } from 'vitest';

import { buildLanes } from '../../journey/journeyModel';
import { docRow, gateDetail, mixWithEvidence, run } from '../../journey/__tests__/detailFixtures';
import { healthyMix, soloV0 } from '../../journey/__tests__/fixtures';
import { evidenceRowsFor } from '../blocks/evidenceRows';
import { reasonBody, weakestByHealth } from '../headline';
import { joinHealth } from '../layer1/healthModel';
import { docsChangeLog, groupDocs } from '../presets/docsModel';
import { commandRows, coverageTrend, median, slowest } from '../presets/gateModel';
import { draftProblem, draftToCommands, slugFor } from '../presets/useCommandsEditor';

function steps(snap = healthyMix()) {
  const { before, after } = buildLanes(snap);
  return joinHealth([...before, ...after], snap.health);
}

describe('weakestByHealth', () => {
  it('names red before stale, amber and unmeasured', () => {
    expect(weakestByHealth(steps())?.node.id).toBe('land');
  });

  it('ranks stale over amber, amber over unmeasured, ties by step order', () => {
    const snap = healthyMix();
    const noRed = { ...snap, health: snap.health.map((h) => (h.stepId === 'land' ? { ...h, health: 'green' as const } : h)) };
    expect(weakestByHealth(steps(noRed))?.node.id).toBe('commit');
    const noStale = { ...noRed, health: noRed.health.map((h) => (h.stepId === 'commit' ? { ...h, health: 'green' as const } : h)) };
    // gate and tests are both amber: gate comes first in step order.
    expect(weakestByHealth(steps(noStale))?.node.id).toBe('gate');
    const onlyUnmeasured = { ...noStale, health: noStale.health.map((h) => (h.health === 'amber' ? { ...h, health: 'green' as const } : h)) };
    expect(weakestByHealth(steps(onlyUnmeasured))?.node.id).toBe('sync');
  });

  it('names nothing when every step is green or instructed', () => {
    const snap = healthyMix();
    const green = { ...snap, health: snap.health.map((h) => (h.health === 'instructed' ? h : { ...h, health: 'green' as const })) };
    expect(weakestByHealth(steps(green))).toBeNull();
  });

  it('trims a reason to a sentence body', () => {
    expect(reasonBody('tsc 74s over 60s budget.')).toBe('tsc 74s over 60s budget');
    expect(reasonBody('  ')).toBeNull();
    expect(reasonBody(null)).toBeNull();
  });
});

describe('gateModel', () => {
  it('groups runs per command with median, pass rate over answered runs and the budget', () => {
    const rows = commandRows(gateDetail().runs, null);
    const byId = Object.fromEntries(rows.map((r) => [r.commandId, r]));
    expect(rows.map((r) => r.commandId)).toEqual(['tsc', 'eslint', 'check', 'clippy']);
    expect(byId.tsc!.medianMs).toBe(61_000);
    expect(byId.tsc!.budgetMs).toBe(60_000);
    expect(byId.eslint!.passRate).toBe(50);
    expect(byId.eslint!.answered).toBe(2);
    expect(byId.eslint!.firstError).toContain('never used');
    // A timeout and a non-run are not votes and not speeds.
    expect(byId.check!.passRate).toBeNull();
    expect(byId.check!.medianMs).toBeNull();
    expect(byId.clippy!.passRate).toBeNull();
    expect(slowest(rows)?.commandId).toBe('tsc');
  });

  it('keeps a configured command that never ran, and honours a budget override', () => {
    const rows = commandRows([], [{ id: 'fmt', command: 'cargo fmt --check', kind: 'lint', budgetMs: 5_000 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.latest).toBeNull();
    expect(rows[0]!.budgetMs).toBe(5_000);
    expect(rows[0]!.budgetOverridden).toBe(true);
    expect(slowest(rows)).toBeNull();
  });

  it('reads the coverage trend oldest first', () => {
    const runs = [run('cov', 'coverage', 'passed', 1, { valuePct: 63 }), run('cov', 'coverage', 'failed', 1), run('cov', 'coverage', 'passed', 1, { valuePct: 58 })];
    expect(coverageTrend(runs)).toEqual([58, 63]);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

describe('commands draft', () => {
  it('derives unique ids from the command and validates rows', () => {
    const taken = new Set(['npm-run-lint']);
    expect(slugFor('npm run lint', taken)).toBe('npm-run-lint-2');
    const cmds = draftToCommands([
      { key: 'a', id: '', command: ' npm run lint ', kind: 'lint', budgetSec: '' },
      { key: 'b', id: 'tsc', command: 'npx tsc', kind: 'typecheck', budgetSec: '90' },
    ]);
    expect(cmds).toEqual([
      { id: 'npm-run-lint', command: 'npm run lint', kind: 'lint', budgetMs: null },
      { id: 'tsc', command: 'npx tsc', kind: 'typecheck', budgetMs: 90_000 },
    ]);
    expect(draftProblem({ key: 'c', id: '', command: '', kind: 'lint', budgetSec: '' })).toBe('command');
    expect(draftProblem({ key: 'd', id: '', command: 'x', kind: 'lint', budgetSec: '0' })).toBe('budget');
  });
});

describe('docsModel', () => {
  it('groups docs worst first and reads an unknown status as unverifiable', () => {
    const groups = groupDocs([docRow('b.md', 'clean'), docRow('a.md', 'broken'), docRow('c.md', 'weird'), docRow('d.md', 'stale')]);
    expect(groups.map((g) => [g.status, g.docs.map((d) => d.docPath)])).toEqual([
      ['broken', ['a.md']], ['stale', ['d.md']], ['unverifiable', ['c.md']], ['clean', ['b.md']],
    ]);
  });

  it('logs only the changes that recorded a docs outcome', () => {
    const log = docsChangeLog(mixWithEvidence().evidence);
    expect(log.map((r) => r.item.sourceRef)).toEqual(['f00dbabe1234567', 'task-42']);
    expect(log[0]!.detail).toContain('old store');
  });
});

describe('evidenceRowsFor', () => {
  it('joins the window to one step and never substitutes a missing note', () => {
    const rows = evidenceRowsFor('land', mixWithEvidence().evidence);
    expect(rows.map((r) => [r.outcome, r.detail])).toEqual([
      ['skipped', 'Merged locally without a pull request'],
      ['done', null],
      ['failed', 'The merge was reverted'],
    ]);
    expect(evidenceRowsFor(null, soloV0().evidence)).toEqual([]);
  });
});
