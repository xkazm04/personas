import { describe, it, expect } from 'vitest';

import { buildPopulateBrief, type PopulateGates } from './populateDispatch';
import type { ImproveRaw } from './improve/ImproveContext';
import type { AppPassport } from './passportModel';

// buildPopulateBrief reads only identity + four project fields; the partial
// literals below are the whole input surface it touches.
const passport = { identity: { name: 'Demo', slug: 'demo' } } as AppPassport;
const raw = { project: { id: 'p1', root_path: 'C:/demo', github_url: null, tech_stack: null } } as ImproveRaw;
const gates: PopulateGates = {
  contexts: { verdict: 'skip', groupCount: 4, newestAt: null },
  features: { verdict: 'skip', count: 3, proposed: 0 },
  kpis: { verdict: 'full', active: 0, proposed: 0 },
  bridgePort: null,
};

describe('buildPopulateBrief', () => {
  const brief = buildPopulateBrief(passport, raw, [], gates, ['kpis']);

  it('keeps the blank line before each paragraph so it does not join the list above', () => {
    // Without the separator, markdown reads the SKIP rule as a lazy
    // continuation of the KPIs bullet and the vault note as part of the last
    // connector bullet.
    expect(brief).toContain('0 proposed\n\nA `SKIP` verdict');
    expect(brief).toContain('wiring pass.\n\nCredential VALUES');
    expect(brief).toContain('## Target\n\n- Project: Demo (demo)');
  });

  it('drops absent optional lines without leaving a run of blank lines', () => {
    expect(brief).not.toContain('Stack:');
    expect(brief).not.toMatch(/\n{3,}/);
  });
});
