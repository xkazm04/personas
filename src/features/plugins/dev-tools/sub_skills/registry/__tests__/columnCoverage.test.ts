import { describe, expect, it } from 'vitest';

import { columnCoveragePct, type RegistryColumn } from '../registryTypes';

// The skill map's column figure answers "how much of this repo has the fleet
// actually touched". The backend supplies a DISTINCT count, so it is a true
// union — but only in workspace mode. These tests pin the distinction the
// operator would otherwise be misled by: absent is not zero.

const column = (over: Partial<RegistryColumn>): RegistryColumn => ({
  id: 'p1', name: 'personas', rootPath: 'C:/dolla/personas', units: 0, presentCount: 0, ...over,
});

describe('columnCoveragePct', () => {
  it('reports the percentage of a project whose contexts have been touched', () => {
    expect(columnCoveragePct(column({ units: 208, coveredUnits: 52 }))).toBe(25);
  });

  it('rounds to a whole percent', () => {
    expect(columnCoveragePct(column({ units: 3, coveredUnits: 1 }))).toBe(33);
  });

  it('returns null — not 0 — when the column carries no union', () => {
    // Project mode: columns are context GROUPS and no per-group union exists.
    // Rendering 0% there would claim the fleet had touched nothing.
    expect(columnCoveragePct(column({ units: 40 }))).toBeNull();
  });

  it('returns null rather than dividing by zero for a project with no contexts', () => {
    expect(columnCoveragePct(column({ units: 0, coveredUnits: 0 }))).toBeNull();
  });

  it('reports a fully covered project as 100', () => {
    expect(columnCoveragePct(column({ units: 12, coveredUnits: 12 }))).toBe(100);
  });
});
