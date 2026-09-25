import { describe, expect, it } from 'vitest';
import { parseBrainLinks } from '../parseBrainLinks';

describe('parseBrainLinks', () => {
  it('returns empty for content with no memory references', () => {
    expect(parseBrainLinks('')).toEqual([]);
    expect(parseBrainLinks('Just regular markdown, no ids here.')).toEqual([]);
  });

  it('extracts a single goal reference', () => {
    expect(parseBrainLinks('See goal_a1b2c3 for the next step.')).toEqual([
      { kind: 'goal', id: 'goal_a1b2c3', raw: 'goal_a1b2c3' },
    ]);
  });

  it('handles multiple kinds in one body', () => {
    const links = parseBrainLinks(
      'Earlier I logged design_decision_xyz and procedural_abc. Also see fact_qwe.',
    );
    expect(links.map((l) => l.kind)).toEqual([
      'design_decision',
      'procedural',
      'fact',
    ]);
  });

  it('dedupes repeated references but preserves first-seen order', () => {
    const links = parseBrainLinks(
      'goal_aaa first, then backlog_bbb, then goal_aaa again, then ritual_ccc.',
    );
    expect(links.map((l) => l.raw)).toEqual([
      'goal_aaa',
      'backlog_bbb',
      'ritual_ccc',
    ]);
  });

  it('matches inside backtick spans (markdown code)', () => {
    const links = parseBrainLinks('See `goal_a1b2c3` for context.');
    expect(links).toEqual([
      { kind: 'goal', id: 'goal_a1b2c3', raw: 'goal_a1b2c3' },
    ]);
  });

  it('ignores orchestration tokens like op_xxxx and sess_yyyy', () => {
    expect(
      parseBrainLinks('Triggered by op_abc123 in sess_def456.'),
    ).toEqual([]);
  });

  it('matches design_decision before falling through to shorter prefixes', () => {
    const links = parseBrainLinks('design_decision_abc is logged.');
    expect(links).toEqual([
      { kind: 'design_decision', id: 'design_decision_abc', raw: 'design_decision_abc' },
    ]);
  });

  it('ignores unknown kinds like persona_xxx', () => {
    expect(parseBrainLinks('See persona_aaa1234 (not a brain kind).')).toEqual(
      [],
    );
  });

  it('preserves the kind name correctly for "doctrine"', () => {
    expect(parseBrainLinks('refer to doctrine_intent-line for context')).toEqual(
      [{ kind: 'doctrine', id: 'doctrine_intent-line', raw: 'doctrine_intent-line' }],
    );
  });

  it('handles hyphens and digits in the id segment', () => {
    expect(
      parseBrainLinks('see procedural_when-X-then-Y-v2 for the rule.'),
    ).toEqual([
      {
        kind: 'procedural',
        id: 'procedural_when-X-then-Y-v2',
        raw: 'procedural_when-X-then-Y-v2',
      },
    ]);
  });
});
