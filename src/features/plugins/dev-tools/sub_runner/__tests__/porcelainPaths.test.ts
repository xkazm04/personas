// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { porcelainPaths } from '../porcelainPaths';

describe('porcelainPaths', () => {
  it('strips the XY prefix', () => {
    expect(porcelainPaths([' M src/a.ts', '?? notes.txt', 'A  b/c.rs', ' D gone.md']))
      .toEqual(['src/a.ts', 'notes.txt', 'b/c.rs', 'gone.md']);
  });
  it('yields both sides of a rename', () => {
    expect(porcelainPaths(['R  old/a.ts -> new/a.ts'])).toEqual(['old/a.ts', 'new/a.ts']);
  });
  it('decodes quoted names with spaces and utf-8 octal escapes', () => {
    expect(porcelainPaths(['?? "my file.txt"', '?? "caf\\303\\251.md"'])).toEqual(['my file.txt', 'café.md']);
  });
  it('keeps an untracked directory entry', () => {
    expect(porcelainPaths(['?? build/'])).toEqual(['build/']);
  });
});
