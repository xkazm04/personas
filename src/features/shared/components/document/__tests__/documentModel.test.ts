import { describe, expect, it } from 'vitest';
import {
  editablePart,
  insertRowAfter,
  railBands,
  removeRow,
  rowPrefix,
  spliceRow,
  splitBlocks,
  splitRowAt,
  weightOf,
} from '../documentModel';

const at = (body: string, b: { offset: number; text: string }) =>
  body.slice(b.offset, b.offset + b.text.length);

describe('splitBlocks', () => {
  it('splits paragraphs on blank lines and drops the blanks', () => {
    const blocks = splitBlocks('s', 'one\n\ntwo\n\n\nthree');
    expect(blocks.map((b) => b.text)).toEqual(['one', 'two', 'three']);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(blocks.map((b) => b.id)).toEqual(['s:0', 's:1', 's:2']);
  });

  // The regression the owner caught: a manifest is mostly bullets, and a
  // click on one bullet must select THAT bullet, not the whole list.
  it('makes every list item its own row', () => {
    const body = '- You design and direct.\n- You create projects.\n- Everything is built by its App Master.';
    const blocks = splitBlocks('s', body);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === 'item')).toBe(true);
    expect(blocks.map((b) => b.content)).toEqual([
      'You design and direct.',
      'You create projects.',
      'Everything is built by its App Master.',
    ]);
    expect(blocks.map((b) => b.marker)).toEqual(['-', '-', '-']);
  });

  it('keeps nested indent on an item so Operation defaults still reads as nested', () => {
    const body = '- Charters:\n  - enterprise-solution-design: unset\n  - workforce-planning: unset';
    const blocks = splitBlocks('s', body);
    expect(blocks.map((b) => b.indent)).toEqual([0, 2, 2]);
    expect(blocks.map((b) => b.kind)).toEqual(['item', 'item', 'item']);
  });

  it('attaches a continuation line to its item rather than starting a paragraph', () => {
    const body = '- first line\n  carries on here\n- second';
    const blocks = splitBlocks('s', body);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.content).toBe('first line\ncarries on here');
  });

  it('makes a heading line its own row with its depth', () => {
    const blocks = splitBlocks('s', '## What I own\n- a thing');
    expect(blocks.map((b) => [b.kind, b.depth])).toEqual([
      ['heading', 2],
      ['item', 0],
    ]);
  });

  it('reads the corpus pseudo-headings as labels without rewriting them', () => {
    const body = 'MANDATE — what the role is:\n- You design and direct.\n\nBOUNDARIES:\n- one';
    const blocks = splitBlocks('s', body);
    expect(blocks.map((b) => [b.kind, b.depth])).toEqual([
      ['heading', 3], ['item', 0], ['heading', 3], ['item', 0],
    ]);
    expect(blocks[0]?.text).toBe('MANDATE — what the role is:');
  });

  it('does not mistake an ordinary sentence for a label', () => {
    const blocks = splitBlocks('s', 'You are the ARCHITECT of the Bank workspace.');
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('reports offsets that index the ORIGINAL body for every kind', () => {
    const body = 'Intro para.\n\n## Head\n- one\n  - nested\n- two\n\ntail para';
    for (const b of splitBlocks('s', body)) expect(at(body, b)).toBe(b.text);
  });

  it('gives repeated rows distinct, correct offsets', () => {
    const body = '- same line\n- same line\n- same line';
    const blocks = splitBlocks('s', body);
    expect(new Set(blocks.map((b) => b.offset)).size).toBe(3);
    for (const b of blocks) expect(at(body, b)).toBe(b.text);
  });

  it('keeps a fenced block whole even when it contains a blank line', () => {
    const body = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nafter';
    const blocks = splitBlocks('s', body);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(at(body, blocks[1]!)).toBe(blocks[1]!.text);
  });

  it('never rewrites its input', () => {
    const body = '# Head\n\n- a\n  - nested\n\ntail';
    for (const b of splitBlocks('s', body)) expect(body).toContain(b.text);
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
  const sec = (id: string, lines: number) => ({
    id, heading: id, body: 'x\n'.repeat(lines), author: 'you' as const, editable: true,
  });

  it('returns percentages that sum to 100', () => {
    const bands = railBands([sec('a', 4), sec('b', 400)]);
    expect(bands.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('keeps a tiny section clickable beside a huge one', () => {
    const [small, large] = railBands([sec('a', 1), sec('b', 2000)]);
    expect(small).toBeGreaterThanOrEqual(5);
    expect(large).toBeGreaterThan(small!);
  });

  it('is empty for no sections', () => {
    expect(railBands([])).toEqual([]);
  });
});

describe('row editing', () => {
  const body = [
    'You are the ARCHITECT of the `Bank` workspace.',
    '',
    'MANDATE — what the role is:',
    '- You design and direct.',
    '- Charters:',
    '  - enterprise-solution-design: unset',
    '  continued here',
    '',
    '## What I own',
    '1. first',
  ].join('\n');

  it('splices every row back to a byte-identical body when nothing changed', () => {
    for (const b of splitBlocks('s', body)) {
      expect(spliceRow(body, b, editablePart(b))).toBe(body);
    }
  });

  it('keeps the bullet and indent outside the editable part', () => {
    const nested = splitBlocks('s', body).find((b) => b.text.startsWith('  - enterprise'))!;
    expect(rowPrefix(nested)).toBe('  - ');
    const next = spliceRow(body, nested, 'workforce-planning: set');
    expect(next).toContain('\n  - workforce-planning: set\n');
    expect(next).toContain('## What I own');
  });

  it('never touches a heading marker when its text is edited', () => {
    const h = splitBlocks('s', body).find((b) => b.kind === 'heading' && b.depth === 2)!;
    expect(spliceRow(body, h, 'What I run')).toContain('\n## What I run\n');
  });

  it('inserts a sibling bullet at the same indent and marker', () => {
    const item = splitBlocks('s', body).find((b) => b.text === '- You design and direct.')!;
    const { body: next, caret } = insertRowAfter(body, item);
    expect(next).toContain('- You design and direct.\n- \n- Charters:');
    expect(next.slice(caret - 2, caret)).toBe('- ');
  });

  it('numbers the next ordered item', () => {
    const item = splitBlocks('s', body).find((b) => b.marker === '1.')!;
    expect(insertRowAfter(body, item).body.endsWith('1. first\n2. ')).toBe(true);
  });
});

describe('an empty new bullet', () => {
  it('stays a writable bullet with an empty editable part', () => {
    const body = '- one\n- \n- three';
    const empty = splitBlocks('s', body)[1]!;
    expect(empty.text).toBe('- ');
    expect(editablePart(empty)).toBe('');
    expect(spliceRow(body, empty, 'two')).toBe('- one\n- two\n- three');
  });
});

describe('row split and removal', () => {
  const body = '- alpha beta\n- gamma\n\nlast para';

  it('splits a bullet at the caret into two sibling bullets', () => {
    const first = splitBlocks('s', body)[0]!;
    const { body: next, caret } = splitRowAt(body, first, 'alpha'.length);
    expect(next).toBe('- alpha\n-  beta\n- gamma\n\nlast para');
    expect(next.slice(caret)).toBe(' beta\n- gamma\n\nlast para');
  });

  it('splits a paragraph into two paragraphs', () => {
    const para = splitBlocks('s', body).find((b) => b.kind === 'paragraph')!;
    expect(splitRowAt(body, para, 4).body).toBe('- alpha beta\n- gamma\n\nlast\n\n para');
  });

  it('removes a row without leaving a blank gap, keeping every other row intact', () => {
    const gamma = splitBlocks('s', body).find((b) => b.text === '- gamma')!;
    const next = removeRow(body, gamma);
    expect(next).toBe('- alpha beta\n\nlast para');
    expect(splitBlocks('s', next).map((b) => b.text)).toEqual(['- alpha beta', 'last para']);
  });

  it('removes the first row cleanly', () => {
    const first = splitBlocks('s', body)[0]!;
    expect(removeRow(body, first)).toBe('- gamma\n\nlast para');
  });
});
