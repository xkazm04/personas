/**
 * TWO DRAWERS, ONE SURFACE.
 *
 * The docket and the operator's queue hang off the same right edge. The wrong
 * implementation - a boolean each - type-checks, lints clean and screenshots
 * fine right up to the moment both are open, at which point one is drawn over
 * the other and the surface behind it is unreachable. `useBlueprintState`
 * keeps ONE drawer slot instead, and only an assertion tells that apart.
 *
 * Also held here: `Q` reaches the queue at all (the key had to be free of the
 * ten this page already binds), and `Esc` shuts it, because a drawer with no
 * way out is how the docket's own Esc arm was earned.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

import { Blueprint } from '../Blueprint';
import { buildModel } from '../model/buildModel';
import { EMPTY_DOCKET } from '../model/docket';
import type { BlueprintStrings, BlueprintWords } from '../words';
import { BlueprintWordsProvider } from '../words';

import { plan } from './fixture';

// The English catalog is the generated type's own source, so this names the
// invariant rather than hiding a shape mismatch: `types.ts` is codegen'd from
// exactly this file.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};

function renderPage() {
  return render(
    <BlueprintWordsProvider value={words}>
      <Blueprint
        model={buildModel(plan())}
        docket={EMPTY_DOCKET}
        words={words}
        queue={<p data-role="test-lane">{en.companions.blueprint.console.lane_empty}</p>}
      />
    </BlueprintWordsProvider>,
  );
}

const root = () => document.querySelector('[data-role="cb-blueprint"]')!;
const shut = (el: Element | null) => el?.getAttribute('aria-hidden') === 'true';

describe('the queue drawer is the docket', () => {
  it('opens on Q, shuts on Esc, and carries the lane the page handed it', () => {
    const { container } = renderPage();
    const queue = () => container.querySelector('[data-role="cb-queue"]');
    expect(shut(queue())).toBe(true);

    fireEvent.keyDown(root(), { key: 'q' });
    expect(shut(queue())).toBe(false);
    // The lane is the page's node, not a second one drawn here.
    expect(queue()?.querySelector('[data-role="test-lane"]')).not.toBeNull();

    fireEvent.keyDown(root(), { key: 'Escape' });
    expect(shut(queue())).toBe(true);
  });

  it('opens from the bar button as well as the key', () => {
    const { container } = renderPage();
    const toggle = container.querySelector('[data-role="cb-queue-toggle"]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(shut(container.querySelector('[data-role="cb-queue"]'))).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('never lets both drawers hold the surface at once', () => {
    const { container } = renderPage();
    const queue = () => container.querySelector('[data-role="cb-queue"]');
    const docket = () => container.querySelector('[data-role="cb-docket"]');

    fireEvent.keyDown(root(), { key: 'd' });
    expect(shut(docket())).toBe(false);
    expect(shut(queue())).toBe(true);

    // The second key SWAPS rather than stacking.
    fireEvent.keyDown(root(), { key: 'q' });
    expect(shut(queue())).toBe(false);
    expect(shut(docket())).toBe(true);

    fireEvent.keyDown(root(), { key: 'd' });
    expect(shut(docket())).toBe(false);
    expect(shut(queue())).toBe(true);
  });

  it('leaves the ledger cursor where it was while the queue holds the surface', () => {
    const { container } = renderPage();
    const selected = () =>
      container.querySelector('[data-cb-row][aria-selected="true"]')?.getAttribute('data-cb-row');
    expect(selected()).toBe('0');

    fireEvent.keyDown(root(), { key: 'q' });
    fireEvent.keyDown(root(), { key: 'j' });
    fireEvent.keyDown(root(), { key: 'j' });
    expect(selected()).toBe('0');

    fireEvent.keyDown(root(), { key: 'Escape' });
    fireEvent.keyDown(root(), { key: 'j' });
    expect(selected()).toBe('1');
  });
});
