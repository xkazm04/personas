import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compare,
  documentedModules,
  edgesInSource,
  measure,
  readBaseline,
  targetOf,
} from '../../../scripts/check-agents-sub-boundaries.mjs';

/**
 * `src/features/agents/AGENTS.md` is the ownership map for the `sub_*` modules,
 * and it says a helper two modules share does not live inside either of them.
 * This test is what makes that sentence operate: it counts every production
 * import that crosses from one `sub_` module into another and holds the count
 * to `scripts/agents-sub-boundaries.baseline.json` in both directions, and it
 * fails when the map's table and the directories on disk disagree.
 */
const REPO = resolve(__dirname, '../../..');

describe('agents sub_* ownership boundaries', () => {
  const measured = measure(REPO);

  it('walks the sub_ modules and holds the crossing ratchet', () => {
    expect(measured.modules.length).toBeGreaterThan(0);
    const problems = compare(measured, readBaseline(REPO), documentedModules(REPO));
    expect(
      problems,
      'run `node scripts/check-agents-sub-boundaries.mjs --verbose` for the sites; a fix that removes a crossing is banked with --update',
    ).toEqual([]);
  });

  it('resolves the alias, relative and dynamic forms, and ignores self-imports', () => {
    const file = 'src/features/agents/sub_editor/components/Example.tsx';
    const source = [
      "import { A } from '@/features/agents/sub_lab/components/A';",
      "import { B } from '../../sub_model_config/libs/B';",
      'const loadDesign = () =>',
      "  import('@/features/agents/sub_design').then((m) => m),",
      ');',
      'import {',
      '  D,',
      "} from '@/features/agents/sub_editor/libs/D';",
      "import { E } from './E';",
      "// import { F } from '@/features/agents/sub_health';",
      "import { G } from '@/features/shared/components/G';",
    ].join('\n');
    const edges = edgesInSource(file, source).map((e) => `${e.to}@${e.line}`);
    expect(edges).toEqual(['sub_lab@1', 'sub_model_config@2', 'sub_design@4']);
  });

  it('does not count a file outside the sub_ modules', () => {
    expect(
      edgesInSource('src/features/agents/components/matrix/X.tsx', "import { Y } from '@/features/agents/sub_glyph/Y';"),
    ).toEqual([]);
    expect(targetOf('src/features/agents/sub_activity/ActivityTab.tsx', '../sub_executions/libs/useExecutionList')).toBe(
      'sub_executions',
    );
  });

  it('reports a new crossing, a rise and an unrecorded drop', () => {
    const baseline = { floor: 0, edges: { 'sub_a -> sub_b': 2, 'sub_c -> sub_d': 1 } };
    const problems = compare(
      { modules: ['sub_a'], filesSeen: 1, edges: { 'sub_a -> sub_b': 3, 'sub_x -> sub_y': 1 }, sites: [] },
      baseline,
    );
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/ROSE 2 -> 3/);
    expect(problems.join('\n')).toMatch(/NEW crossing sub_x -> sub_y/);
    expect(problems.join('\n')).toMatch(/sub_c -> sub_d dropped 1 -> 0/);
  });
});
