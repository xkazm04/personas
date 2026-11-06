import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'kit.css'), 'utf8');

describe('kit.css follows the Console geometry roles', () => {
  it('derives every row height from --row-h (so both density values reach it)', () => {
    expect(css).toMatch(/--krow-h:\s*var\(--row-h,/);
    expect(css).toMatch(/\.k-row\s*\{[^}]*height:\s*var\(--krow-h\)/s);
    expect(css).toMatch(/\.k-table td\s*\{[^}]*height:\s*var\(--krow-h\)/s);
    expect(css).toMatch(/\.k-grp\s*\{[^}]*height:\s*var\(--krow-h\)/s);
  });

  it('reads the gutter and the control heights from the roles', () => {
    expect(css).toContain('--gutter: var(--gutter-page');
    expect(css).toContain('height: var(--control-h)');
    expect(css).toContain('height: var(--control-h-lg)');
    expect(css).toContain('min-height: var(--group-h');
  });

  it('keeps no fixed 56px row, 40px gutter, alternating band or glow', () => {
    expect(css).not.toMatch(/--row-h:\s*56px/);
    expect(css).not.toMatch(/--gutter:\s*40px/);
    expect(css).not.toMatch(/nth-child\(even\)\s*\{\s*--band/);
    expect(css).toContain('--glow: transparent');
  });

  it('maps the old rule names onto the hairline roles', () => {
    expect(css).toContain('--rule: var(--hair)');
    expect(css).toContain('--line: var(--hair-2)');
    expect(css).toContain('--ghost: var(--grid)');
  });
});
