import { describe, expect, it } from 'vitest';
import { railBands, splitBlocks, weightOf } from '../documentModel';

describe('splitBlocks', () => {
  it('splits on blank lines and drops the blanks', () => {
    const blocks = splitBlocks('s', 'one\n\ntwo\n\n\nthree');
    expect(blocks.map((b) => b.text)).toEqual(['one', 'two', 'three']);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(blocks.map((b) => b.id)).toEqual(['s:0', 's:1', 's:2']);
  });

  it('reports an offset that indexes the ORIGINAL body, not the joined text', () => {
    const body = 'first para\n\nsecond para\n\nthird';
    for (const block of splitBlocks('s', body)) {
      expect(body.slice(block.offset, block.offset + block.text.length)).toBe(block.text);
    }
  });

  // The whole point of computing offsets from line lengths rather than
  // indexOf: a document that grows by appending short entries repeats lines.
  it('gives repeated blocks distinct, correct offsets', () => {
    const body = 'same line\n\nsame line\n\nsame line';
    const blocks = splitBlocks('s', body);
    expect(blocks).toHaveLength(3);
    expect(new Set(blocks.map((b) => b.offset)).size).toBe(3);
    for (const block of blocks) {
      expect(body.slice(block.offset, block.offset + block.text.length)).toBe(block.text);
    }
  });

  it('keeps a fenced block whole even when it contains a blank line', () => {
    const body = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nafter';
    const blocks = splitBlocks('s', body);
    expect(blocks.map((b) => b.text)).toEqual([
      'intro',
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
      'after',
    ]);
    const fence = blocks[1]!;
    expect(body.slice(fence.offset, fence.offset + fence.text.length)).toBe(fence.text);
  });

  it('marks a heading-led block', () => {
    const blocks = splitBlocks('s', '## What I own\n\nplain text');
    expect(blocks[0]?.isHeading).toBe(true);
    expect(blocks[1]?.isHeading).toBe(false);
  });

  it('never rewrites its input: joining the blocks preserves every character of text', () => {
    const body = '# Head\n\n- a\n  - nested\n\ntail';
    for (const block of splitBlocks('s', body)) {
      expect(body).toContain(block.text);
    }
  });

  it('returns nothing for an empty or whitespace-only body', () => {
    expect(splitBlocks('s', '')).toEqual([]);
    expect(splitBlocks('s', '\n\n   \n')).toEqual([]);
  });
});

describe('weightOf', () => {
  it('counts non-blank lines only', () => {
    expect(weightOf('a\n\nb\n\n\nc')).toBe(3);
    expect(weightOf('')).toBe(0);
  });
});

describe('railBands', () => {
  it('returns percentages that sum to 100', () => {
    const sections = [
      { id: 'a', heading: 'A', body: 'x\n'.repeat(4), author: 'you' as const, editable: true },
      { id: 'b', heading: 'B', body: 'x\n'.repeat(400), author: 'agent' as const, editable: false },
    ];
    const bands = railBands(sections);
    expect(bands.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('keeps a tiny section clickable beside a huge one', () => {
    const sections = [
      { id: 'a', heading: 'A', body: 'x', author: 'you' as const, editable: true },
      { id: 'b', heading: 'B', body: 'x\n'.repeat(2000), author: 'agent' as const, editable: false },
    ];
    const [small, large] = railBands(sections);
    expect(small).toBeGreaterThanOrEqual(5);
    expect(large).toBeGreaterThan(small!);
  });

  it('is empty for no sections', () => {
    expect(railBands([])).toEqual([]);
  });
});
