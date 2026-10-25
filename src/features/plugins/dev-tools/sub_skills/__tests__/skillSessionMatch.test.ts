// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { skillsRunBy } from '../skillSessionMatch';

const NAMES = ['perfect', 'perfect-loop', 'scan-sweep'];

describe('skillsRunBy', () => {
  it('finds the skill in the first arg (a Use-dialog dispatch)', () => {
    expect(skillsRunBy({ args: ['/scan-sweep --optimize'], state: 'running' }, NAMES)).toEqual(['scan-sweep']);
  });

  it('finds the skill in a later arg (an Athena-dispatched session)', () => {
    const session = { args: ['--append-system-prompt', 'steward', '/perfect run'], state: 'awaiting_input' };
    expect(skillsRunBy(session, NAMES)).toEqual(['perfect']);
  });

  it('does not read a longer name as its prefix', () => {
    expect(skillsRunBy({ args: ['x', '/perfect-loop go'], state: 'running' }, NAMES)).toEqual(['perfect-loop']);
  });

  it('a finished session runs nothing', () => {
    expect(skillsRunBy({ args: ['/perfect'], state: 'completed' }, NAMES)).toEqual([]);
  });
});
