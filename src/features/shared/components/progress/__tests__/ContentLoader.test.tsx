import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ContentLoader from '../ContentLoader';

const repoRoot = resolve(__dirname, '../../../../../..');

/**
 * ContentLoader drew `/illustrations/loading/*.png`, which 7d6e67ad04 deleted.
 * With `alt=""` a missing image renders as nothing, so the loader was an empty
 * box. Guard both halves: it renders the calm ghost, and any asset path its
 * source still names must exist under public/.
 */
describe('ContentLoader', () => {
  it('renders the calm ghost, not an image', () => {
    const { container } = render(<ContentLoader variant="panel" hint="comparison" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('content-loader-ghost')).toBeTruthy();
  });

  it('shows its label when given one', () => {
    render(<ContentLoader label="Loading logs" />);
    expect(screen.getByText('Loading logs')).toBeTruthy();
  });

  it('names no public asset that does not exist', () => {
    const src = readFileSync(resolve(__dirname, '../ContentLoader.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const assets = [...src.matchAll(/['"`](\/[\w./-]+\.(?:png|webp|svg|jpg))['"`]/g)].map((m) => m[1]!);
    for (const a of assets) expect(existsSync(resolve(repoRoot, 'public' + a))).toBe(true);
  });
});
