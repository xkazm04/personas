import { describe, it, expect } from 'vitest';
import { readV3Fields } from '../recipeV3';

/**
 * `spec` is a DB JSON blob, so every one of these cases is reachable in a real
 * row: a pre-v3 charter has none of the keys, and a row written by an older
 * build can have a partial or differently-typed version of any of them. The
 * assertions that matter are the ones that return `undefined` rather than an
 * empty array, because a caller renders NOTHING for `undefined` and an empty
 * block for `[]`.
 */
describe('readV3Fields', () => {
  it('returns nothing at all for a pre-v3 charter', () => {
    expect(readV3Fields({})).toEqual({});
    expect(readV3Fields({ inputSchema: [], memoryPolicy: { enabled: true } })).toEqual({});
  });

  it('survives a spec that is not an object', () => {
    for (const bad of [null, undefined, 'x', 7, [], true]) {
      expect(readV3Fields(bad)).toEqual({});
    }
  });

  it('reads a well-formed recipeRef and rejects a half-formed one', () => {
    expect(readV3Fields({ recipeRef: { slug: 'a-b', version: '0.1.0' } }).recipeRef)
      .toEqual({ slug: 'a-b', version: '0.1.0' });
    expect(readV3Fields({ recipeRef: { slug: 'a-b' } }).recipeRef).toBeUndefined();
    expect(readV3Fields({ recipeRef: { slug: '', version: '0.1.0' } }).recipeRef).toBeUndefined();
    expect(readV3Fields({ recipeRef: 'a-b@0.1.0' }).recipeRef).toBeUndefined();
  });

  it('keeps only well-formed activities and drops the rest', () => {
    const out = readV3Fields({
      activities: [
        { id: 'a', label: 'Look', kind: 'observe' },
        { id: 'b', label: 'Judge', kind: 'inspect' },   // kind outside the closed set
        { id: 'c', kind: 'act' },                        // no label
        { label: 'no id', kind: 'act' },
        null,
        { id: 'd', label: 'Ship', kind: 'deliver' },
      ],
    });
    expect(out.activities?.map((a) => a.id)).toEqual(['a', 'd']);
  });

  it('returns undefined rather than an empty list when nothing survives', () => {
    expect(readV3Fields({ activities: [{ id: 'x', kind: 'nope' }] }).activities).toBeUndefined();
    expect(readV3Fields({ activities: [] }).activities).toBeUndefined();
    expect(readV3Fields({ activities: 'observe' }).activities).toBeUndefined();
  });

  it('strips desktop from connectorTypes because it binds to nothing', () => {
    expect(readV3Fields({ connectorTypes: ['analytics', 'desktop', 'social'] }).connectorTypes)
      .toEqual(['analytics', 'social']);
    expect(readV3Fields({ connectorTypes: ['desktop'] }).connectorTypes).toBeUndefined();
  });

  it('trims and drops empty entries in the string lists', () => {
    expect(readV3Fields({ connectorTypes: [' analytics ', '', null, 3] }).connectorTypes)
      .toEqual(['analytics']);
    expect(readV3Fields({ dependencies: ['ffmpeg', '  '] }).dependencies).toEqual(['ffmpeg']);
    expect(readV3Fields({ dependencies: [] }).dependencies).toBeUndefined();
  });

  it('reads each field independently, so a partial spec still yields what is there', () => {
    const out = readV3Fields({ dependencies: ['ffmpeg'], activities: 'broken' });
    expect(out.dependencies).toEqual(['ffmpeg']);
    expect(out.activities).toBeUndefined();
    expect(out.recipeRef).toBeUndefined();
    expect(out.connectorTypes).toBeUndefined();
  });
});
