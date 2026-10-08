import { describe, it, expect } from 'vitest';

import { buildGoalBreakdownPrompt, DESCRIPTION_CLIP } from '../goalBreakdownPrompt';

const goal = { id: 'g_1', title: 'Ship the importer', description: 'Read CSV and JSON.', status: 'open', progress: 20 };

describe('buildGoalBreakdownPrompt', () => {
  it('points at the milestone and asks for an editable show_ship_goals card bound to it', () => {
    const text = buildGoalBreakdownPrompt({ goal, milestone: { id: 'm_9', name: 'Beta' }, projectName: 'Atlas' });
    expect(text).toContain('`g_1`');
    expect(text).toContain('"Atlas"');
    expect(text).toContain('describe_ship_milestone` (query: `m_9`)');
    expect(text).toContain('show_ship_goals` (milestone_id: `m_9`)');
    expect(text).toContain('nothing is written until he presses Create');
  });

  it('without a milestone proposes in chat and names no card op', () => {
    const text = buildGoalBreakdownPrompt({ goal, milestone: null, projectName: 'Atlas' });
    expect(text).not.toContain('show_ship_goals');
    expect(text).not.toContain('describe_ship_milestone');
    expect(text).toContain('create nothing');
  });

  it('carries the description, clipped past the limit', () => {
    const long = 'x'.repeat(DESCRIPTION_CLIP + 50);
    const text = buildGoalBreakdownPrompt({ goal: { ...goal, description: long }, milestone: null, projectName: 'P' });
    expect(text).toContain(`${'x'.repeat(DESCRIPTION_CLIP)} [...]`);
    expect(text).not.toContain('x'.repeat(DESCRIPTION_CLIP + 1));
  });

  it('says so when the goal has no description rather than pasting an empty block', () => {
    const text = buildGoalBreakdownPrompt({ goal: { ...goal, description: null }, milestone: null, projectName: 'P' });
    expect(text).toContain('no description');
    expect(text).not.toContain('His description');
  });

  it('states status and a rounded progress', () => {
    const text = buildGoalBreakdownPrompt({ goal: { ...goal, progress: 33.6 }, milestone: null, projectName: 'P' });
    expect(text).toContain('`open` with progress 34/100');
  });
});
