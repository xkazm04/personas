/**
 * Adopt blast radius.
 *
 * The property under test: this module agrees with
 * `src-tauri/db/src/repos/dev_workspaces.rs::applicability_matches`, because a
 * card that promises "2 of 9 repos" and a backend that seeds 9 is worse than a
 * card that says nothing.
 */
import { describe, it, expect } from 'vitest';

import { adoptReach, applicabilityMatches, parseApplicability } from '../triageReach';

describe('parseApplicability', () => {
  it('reads every axis it is given', () => {
    const parsed = parseApplicability(
      JSON.stringify({
        layers: ['ui'],
        languages: ['TypeScript'],
        frameworks: ['React'],
        conditions: ['has tests'],
      }),
    );
    expect(parsed).toEqual({
      layers: ['ui'],
      languages: ['TypeScript'],
      frameworks: ['React'],
      conditions: ['has tests'],
    });
  });

  it('treats null, junk and non-objects as no constraints rather than throwing', () => {
    for (const raw of [null, undefined, '', 'not json', '[1,2]', 'null']) {
      expect(parseApplicability(raw)).toEqual({
        layers: [],
        languages: [],
        frameworks: [],
        conditions: [],
      });
    }
  });

  it('drops non-string entries instead of rendering them', () => {
    expect(parseApplicability('{"layers":["ui",7,null]}').layers).toEqual(['ui']);
  });
});

describe('applicabilityMatches — mirrors the backend gate', () => {
  it('applies everywhere when there are no language/framework filters', () => {
    expect(applicabilityMatches(null, 'Rust')).toBe(true);
    expect(applicabilityMatches('{"layers":["ui"]}', 'Rust')).toBe(true);
    expect(applicabilityMatches('{"conditions":["has CI"]}', null)).toBe(true);
  });

  it('gates on languages and frameworks, case-insensitively, as a substring', () => {
    const react = '{"frameworks":["React"]}';
    expect(applicabilityMatches(react, 'react + typescript')).toBe(true);
    expect(applicabilityMatches(react, 'Vue 3 + Vite')).toBe(false);
    expect(applicabilityMatches('{"languages":["TypeScript"]}', 'React + TypeScript')).toBe(true);
  });

  it('matches when ANY filter hits, not all of them', () => {
    const raw = '{"languages":["Rust"],"frameworks":["React"]}';
    expect(applicabilityMatches(raw, 'React only')).toBe(true);
    expect(applicabilityMatches(raw, 'Rust only')).toBe(true);
    expect(applicabilityMatches(raw, 'Go only')).toBe(false);
  });

  it('does not match a repo with no declared stack once filters exist', () => {
    expect(applicabilityMatches('{"frameworks":["React"]}', null)).toBe(false);
  });

  it('ignores blank filter entries rather than matching everything on them', () => {
    // `''` is a substring of every string — a blank filter must not silently
    // widen the blast radius to the whole workspace.
    expect(applicabilityMatches('{"frameworks":["","React"]}', 'Vue')).toBe(false);
  });
});

describe('adoptReach', () => {
  it('counts members and the applicable subset separately', () => {
    const stacks = ['React + TS', 'Vue + TS', 'Rust', null];
    expect(adoptReach('{"frameworks":["React"]}', stacks)).toEqual({ members: 4, applicable: 1 });
    expect(adoptReach(null, stacks)).toEqual({ members: 4, applicable: 4 });
  });

  it('reports an empty workspace as zero of zero, not as everywhere', () => {
    expect(adoptReach(null, [])).toEqual({ members: 0, applicable: 0 });
  });
});
