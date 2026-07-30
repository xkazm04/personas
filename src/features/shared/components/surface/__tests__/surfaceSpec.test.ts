import { describe, expect, it } from 'vitest';

import {
  extractSurfaceSpec,
  parseSurfaceSpec,
  surfaceActionSchema,
} from '../surfaceSpec';

const validSpec = {
  surface: 'v1',
  title: 'Dependency audit',
  summary: '12 packages scanned.',
  blocks: [
    {
      type: 'stat_row',
      stats: [
        { label: 'Scanned', value: 12 },
        { label: 'CVEs', value: '2', tone: 'danger', delta: { label: '+2', direction: 'up' } },
      ],
    },
    {
      type: 'table',
      title: 'Findings',
      columns: [
        { key: 'pkg', label: 'Package' },
        { key: 'severity', label: 'Severity', align: 'right' },
      ],
      rows: [
        { pkg: 'left-pad', severity: 'high' },
        { pkg: 'is-odd', severity: null },
      ],
    },
    {
      type: 'decisions',
      items: [
        {
          id: 'fix-1',
          title: 'Bump left-pad',
          summary: 'Patch available.',
          facts: [{ label: 'risk', value: 'low' }],
          actions: [
            { id: 'a1', label: 'Fix it', tone: 'accept', kind: 'dispatch', prompt: 'Bump left-pad to 1.3.0' },
          ],
        },
      ],
    },
    { type: 'markdown', content: '## Notes\nAll findings verified.' },
    { type: 'gauge', label: 'Confidence', value: 82 },
    { type: 'progress', label: 'Rollout', value: 40, hint: '2 of 5 repos' },
    { type: 'terminal', title: 'Audit log', lines: ['npm audit', 'found 2 vulnerabilities'] },
  ],
};

describe('parseSurfaceSpec', () => {
  it('accepts a fully valid spec with zero dropped blocks', () => {
    const result = parseSurfaceSpec(validSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toBe(0);
    expect(result.spec.blocks).toHaveLength(7);
    expect(result.spec.title).toBe('Dependency audit');
  });

  it('coerces primitive values into bounded strings', () => {
    const result = parseSurfaceSpec({
      surface: 'v1',
      blocks: [{ type: 'stat_row', stats: [{ label: 42, value: true }] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.spec.blocks[0];
    if (block.type !== 'stat_row') throw new Error('wrong block');
    expect(block.stats[0].label).toBe('42');
    expect(block.stats[0].value).toBe('true');
  });

  it('truncates overlong labels instead of failing', () => {
    const result = parseSurfaceSpec({
      surface: 'v1',
      blocks: [{ type: 'gauge', label: 'x'.repeat(500), value: 50 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.spec.blocks[0];
    if (block.type !== 'gauge') throw new Error('wrong block');
    expect(block.label).toHaveLength(48);
  });

  it('clamps out-of-range gauge/progress values instead of rejecting', () => {
    const result = parseSurfaceSpec({
      surface: 'v1',
      blocks: [
        { type: 'gauge', label: 'Over', value: 250 },
        { type: 'progress', label: 'Under', value: -10 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.blocks.map((b) => ('value' in b ? b.value : null))).toEqual([100, 0]);
  });

  it('repairs by dropping invalid blocks and reports the count', () => {
    const result = parseSurfaceSpec({
      surface: 'v1',
      blocks: [
        { type: 'markdown', content: 'kept' },
        { type: 'hologram', content: 'hallucinated block type' },
        { type: 'gauge', label: '', value: 10 }, // empty label → invalid
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.blocks).toHaveLength(1);
    expect(result.dropped).toBe(2);
  });

  it('fails when no block survives repair', () => {
    const result = parseSurfaceSpec({ surface: 'v1', blocks: [{ type: 'hologram' }] });
    expect(result.ok).toBe(false);
  });

  it('rejects non-spec input outright', () => {
    expect(parseSurfaceSpec(null).ok).toBe(false);
    expect(parseSurfaceSpec('surface').ok).toBe(false);
    expect(parseSurfaceSpec({ surface: 'v2', blocks: [] }).ok).toBe(false);
    expect(parseSurfaceSpec({ surface: 'v1', blocks: [] }).ok).toBe(false);
  });

  it('salvages the envelope when title/summary are malformed', () => {
    const result = parseSurfaceSpec({
      surface: 'v1',
      title: { nested: 'object' },
      blocks: [{ type: 'markdown', content: 'ok' }, { bogus: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.blocks).toHaveLength(1);
  });

  it('caps decision actions at 3 and enforces the action shape', () => {
    const action = surfaceActionSchema.safeParse({ id: 'a', label: 'Go', prompt: 'p' });
    expect(action.success).toBe(true);
    if (action.success) {
      expect(action.data.kind).toBe('dispatch');
      expect(action.data.tone).toBe('neutral');
    }
    const tooMany = parseSurfaceSpec({
      surface: 'v1',
      blocks: [
        {
          type: 'decisions',
          items: [
            {
              id: 'i',
              title: 't',
              actions: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, label: 'x', prompt: 'p' })),
            },
          ],
        },
      ],
    });
    // The over-limit block is dropped by repair, leaving nothing renderable.
    expect(tooMany.ok).toBe(false);
  });
});

describe('extractSurfaceSpec', () => {
  it('extracts a spec that IS the whole output document', () => {
    const found = extractSurfaceSpec(JSON.stringify(validSpec));
    expect(found?.spec.title).toBe('Dependency audit');
    expect(found?.dropped).toBe(0);
  });

  it('extracts a spec embedded under a `surface` key', () => {
    const wrapped = { user_message: { content: 'hi' }, surface: validSpec };
    const found = extractSurfaceSpec(JSON.stringify(wrapped));
    expect(found?.spec.blocks.length).toBe(7);
  });

  it('extracts a spec from an NDJSON line', () => {
    const ndjson = [
      JSON.stringify({ emit_event: { type: 'started' } }),
      JSON.stringify(validSpec),
      'not json at all',
    ].join('\n');
    const found = extractSurfaceSpec(ndjson);
    expect(found?.spec.title).toBe('Dependency audit');
  });

  it('reports dropped blocks from a repaired embedded spec', () => {
    const withBadBlock = {
      ...validSpec,
      blocks: [...validSpec.blocks, { type: 'nope' }],
    };
    const found = extractSurfaceSpec(JSON.stringify({ surface: withBadBlock }));
    expect(found?.dropped).toBe(1);
  });

  it('returns null for prose, plain JSON, and empty output', () => {
    expect(extractSurfaceSpec(null)).toBeNull();
    expect(extractSurfaceSpec('')).toBeNull();
    expect(extractSurfaceSpec('# just markdown')).toBeNull();
    expect(extractSurfaceSpec(JSON.stringify({ user_message: { content: 'plain' } }))).toBeNull();
    // `surface` key present but not a valid spec → still null, never a throw.
    expect(extractSurfaceSpec(JSON.stringify({ surface: 'enabled' }))).toBeNull();
  });
});
