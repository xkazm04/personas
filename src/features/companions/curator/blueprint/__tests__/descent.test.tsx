/**
 * The descent, and the one drawing that compares consumers.
 *
 * Two things the module gate of 2026-09-25 had to leave working and one it had
 * to fix, each asserted here rather than in a screenshot:
 *
 * 1. A row still GROWS into its own panels, from the mouse and from the
 *    keyboard, and `Esc` returns to the row you left - including under
 *    `prefers-reduced-motion`, where the whole transition is skipped and the
 *    only thing left to get wrong is the state change itself.
 * 2. The consumer candles draw each project's judged share to scale. They were
 *    amplified ninefold, which saturates above an 11% share, so three projects
 *    at 10.1%, 19.3% and 18.8% all drew as a full column.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

import { Blueprint } from '../Blueprint';
import { ProjectsBlock } from '../ledger/VerdictConsumers';
import { buildModel } from '../model/buildModel';
import { EMPTY_DOCKET } from '../model/docket';
import type { BlueprintModel } from '../model/types';
import type { BlueprintStrings, BlueprintWords } from '../words';
import { BlueprintWordsProvider } from '../words';

import { plan } from './fixture';

const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};

/** `useReducedMotion` reads this; jsdom ships no `matchMedia`. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderPage() {
  const model = buildModel(plan());
  return render(
    <BlueprintWordsProvider value={words}>
      <Blueprint model={model} docket={EMPTY_DOCKET} words={words} />
    </BlueprintWordsProvider>,
  );
}

const root = () => document.querySelector('[data-role="cb-blueprint"]')!;

beforeEach(() => {
  setReducedMotion(false);
  // The descent animates through rAF; jsdom runs it, but the fallbacks the
  // hook uses when an element has no geometry are what this environment hits.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe('the descent grows the row you clicked, and Esc gives it back', () => {
  it('opens the deep layer from the mouse and returns on Esc', async () => {
    const { container } = renderPage();
    expect(root().getAttribute('data-layer')).toBe('ledger');

    const second = container.querySelector('[data-cb-row="1"]')!;
    fireEvent.click(second);
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('deep');
    });

    fireEvent.keyDown(root(), { key: 'Escape' });
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('ledger');
    });
    // The row you left is the row you come back to, not the top of the list.
    expect(container.querySelector('[data-cb-row="1"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('gives the page to the row: the verdict and the console leave with the ledger', async () => {
    const { container } = renderPage();
    const verdict = () => container.querySelector('.cb-verdict')!;
    const consoleSlot = () => container.querySelector('.cb-console-slot')!;
    const ledger = () => container.querySelector('.cb-ledger')!;
    expect(verdict().getAttribute('aria-hidden')).not.toBe('true');
    expect(consoleSlot().getAttribute('aria-hidden')).not.toBe('true');

    fireEvent.click(container.querySelector('[data-cb-row="0"]')!);
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('deep');
    });
    // All three, together: the corpus verdict and her queue are no more about
    // the subject being read than the rest of the ledger is.
    expect(verdict().getAttribute('aria-hidden')).toBe('true');
    expect(consoleSlot().getAttribute('aria-hidden')).toBe('true');
    expect(ledger().getAttribute('aria-hidden')).toBe('true');

    fireEvent.keyDown(root(), { key: 'Escape' });
    await waitFor(() => {
      expect(verdict().getAttribute('aria-hidden')).not.toBe('true');
    });
    expect(consoleSlot().getAttribute('aria-hidden')).not.toBe('true');
    expect(ledger().getAttribute('aria-hidden')).not.toBe('true');
  });

  it('opens from the keyboard alone', async () => {
    renderPage();
    fireEvent.keyDown(root(), { key: 'ArrowDown' });
    fireEvent.keyDown(root(), { key: 'Enter' });
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('deep');
    });
    fireEvent.keyDown(root(), { key: 'Escape' });
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('ledger');
    });
  });

  it('still opens and closes with motion switched off', async () => {
    setReducedMotion(true);
    const { container } = renderPage();
    fireEvent.click(container.querySelector('[data-cb-row="0"]')!);
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('deep');
    });
    // The zoomed row is drawn again as the origin band, which is what "grown"
    // means here: the same row, not a panel that arrived from somewhere else.
    expect(container.querySelector('.cb-dorigin [data-role="cb-ledger-row"]')).not.toBeNull();
    fireEvent.keyDown(root(), { key: 'Escape' });
    await waitFor(() => {
      expect(root().getAttribute('data-layer')).toBe('ledger');
    });
  });
});

describe('the consumer candles draw a share, not a full column', () => {
  const consumers = (
    projects: { slug: string; evaluated: number; pairs: number }[],
  ): BlueprintModel['consumers'] => ({
    projects: projects.map((p) => ({
      slug: p.slug,
      contexts: 1,
      pairs: p.pairs,
      evaluated: p.evaluated,
      staleVerdicts: 0,
      weak: 0,
      state: 'OK',
      reach: null,
    })),
    pairs: 1,
    evaluated: 1,
    staleVerdicts: 0,
    weak: 0,
    staleProjects: 0,
    mapsStale: false,
    problems: [],
  });

  function heights(projects: { slug: string; evaluated: number; pairs: number }[]) {
    const model = { ...buildModel(plan()), consumers: consumers(projects) };
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <ProjectsBlock model={model} />
      </BlueprintWordsProvider>,
    );
    return [...container.querySelectorAll('.cb-cd .cb-fill')].map((el) =>
      Number.parseFloat((el as HTMLElement).style.height),
    );
  }

  it('gives three different shares three different heights', () => {
    // The three the registry actually reports, and the amplified drawing put
    // all of them at the ceiling.
    const drawn = heights([
      { slug: 'personas', evaluated: 179, pairs: 1765 },
      { slug: 'personas-web', evaluated: 41, pairs: 212 },
      { slug: 'ai-registry', evaluated: 12, pairs: 64 },
    ]);
    expect(new Set(drawn).size).toBeGreaterThan(1);
    expect(drawn.every((h) => h < 18)).toBe(true);
    // Ordered as the shares are: 10.1% < 18.8% <= 19.3%.
    expect(drawn[0]).toBeLessThan(drawn[2]);
    expect(drawn[2]).toBeLessThanOrEqual(drawn[1]);
  });

  it('keeps a small share visible and a full one full', () => {
    const [tiny, whole] = heights([
      { slug: 'a', evaluated: 1, pairs: 900 },
      { slug: 'b', evaluated: 40, pairs: 40 },
    ]);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(whole);
    expect(whole).toBe(18);
  });
});

describe('the page it all hangs off still renders', () => {
  it('draws the ledger region and the nine channel heads', () => {
    renderPage();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-role="cb-channel-head"]')).toHaveLength(9);
  });
});
