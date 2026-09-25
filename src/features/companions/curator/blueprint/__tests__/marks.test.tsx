/**
 * The three marks, as a reader actually meets them: in the DOM.
 *
 * The model tests hold the VOCABULARY apart; this holds the INK apart. A
 * union with three arms that all render the same glyph would pass every test
 * above and still tell the reader that an unknown is a zero.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

import { Bands } from '../ledger/Bands';
import { LedgerCell } from '../ledger/LedgerCell';
import { LedgerRow } from '../ledger/LedgerRow';
import { buildModel } from '../model/buildModel';
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

function renderRows() {
  const model = buildModel(plan());
  return render(
    <BlueprintWordsProvider value={words}>
      <div>
        {model.rows.map((row, i) => (
          <LedgerRow key={row.id} row={row} index={i} model={model} current={false} dimmed={false} />
        ))}
        <Bands model={model} />
      </div>
    </BlueprintWordsProvider>,
  );
}

describe('an unknown never renders as a 0', () => {
  it('draws a see-through box where nobody has looked, and no digit', () => {
    const { container } = renderRows();
    const czech = container.querySelector('[data-cb-id="localization/czech"]')!;
    const cells = czech.querySelectorAll('[data-role="cb-ledger-cell"]');
    const deviation = cells[6]!; // channel 7, in display order
    expect(deviation.querySelector('.cb-unkbox')).not.toBeNull();
    expect(deviation.textContent).toBe('');
    expect(deviation.getAttribute('data-cb-tip')).toContain('UNKNOWN');
    expect(deviation.getAttribute('data-cb-tip')).toContain('Not zero');
  });
});

describe('a measured zero, an unknown and a real count are three different marks', () => {
  it('renders three different inks', () => {
    const { container } = renderRows();
    const memory = container.querySelector('[data-cb-id="software-engineering/agent-memory"]')!;
    const czech = container.querySelector('[data-cb-id="localization/czech"]')!;
    const memCells = memory.querySelectorAll('[data-role="cb-ledger-cell"]');
    const czCells = czech.querySelectorAll('[data-role="cb-ledger-cell"]');

    const count = memCells[6]!; // channel 7, scored
    const measuredZero = memCells[0]!; // channel 1, measured and empty
    const unknown = czCells[6]!; // channel 7, never looked at

    expect(count.querySelector('.cb-track')).not.toBeNull();
    expect(count.textContent).toContain('14');
    expect(measuredZero.querySelector('.cb-flat')).not.toBeNull();
    expect(unknown.querySelector('.cb-unkbox')).not.toBeNull();

    // No two of them share a mark.
    const inks = [count, measuredZero, unknown].map((el) =>
      ['cb-track', 'cb-flat', 'cb-unkbox'].filter((c) => el.querySelector(`.${c}`)).join(),
    );
    expect(new Set(inks).size).toBe(3);
  });

  /**
   * The FOURTH ink, held to the same bar as the other three.
   *
   * `unmeasurable` has no arm in `buildModel` yet - the clock figures the
   * projection carries are corpus-wide, so the instrument cannot claim it per
   * subject - which is exactly why it needs a test of its own: the ink exists
   * for the day that claim becomes makeable, and an ink nothing renders is an
   * ink nobody notices has collapsed into its neighbour.
   */
  it('gives the unmeasurable its own ink, distinct from all three', () => {
    const model = buildModel(plan());
    const row = model.rows![0];
    const four = (['scored', 'measured-zero', 'unknown', 'unmeasurable'] as const).map((kind) => {
      const cell =
        kind === 'scored' ? row.cells[7] : ({ kind } as Extract<typeof row.cells[7], { kind: 'unknown' }>);
      const { container } = render(
        <BlueprintWordsProvider value={words}>
          <LedgerCell
            channel={7}
            cell={cell}
            row={row}
            maxPoints={model.maxPoints}
            maxCeiling={model.maxCeiling}
            role="cb-ledger-cell"
          />
        </BlueprintWordsProvider>,
      );
      const el = container.querySelector('[data-role="cb-ledger-cell"]')!;
      return {
        ink: ['cb-track', 'cb-flat', 'cb-unkbox', 'cb-ink-unmeasurable']
          .filter((c) => el.querySelector(`.${c}`))
          .join(),
        tip: el.getAttribute('data-cb-tip') ?? '',
        digits: (el.textContent ?? '').replace(/\D/gu, ''),
      };
    });

    // Four marks, four inks, four sentences - and only the count carries a digit.
    expect(new Set(four.map((f) => f.ink)).size).toBe(4);
    expect(new Set(four.map((f) => f.tip)).size).toBe(4);
    expect(four.slice(1).every((f) => f.digits === '')).toBe(true);
  });
});

describe('the quiet band renders from CuratorPlan.quiet', () => {
  it('draws the count and one chip per bundle, dotted where demand was never read', () => {
    const { container } = renderRows();
    const bands = container.querySelectorAll('[data-role="cb-band-row"]');
    const quiet = bands[bands.length - 1]!;
    expect(quiet.textContent).toContain('4');
    expect(quiet.textContent).toContain(en.companions.blueprint.band_quiet_title);
    const chips = [...quiet.querySelectorAll('.cb-chip')];
    expect(chips).toHaveLength(2);
    const unread = chips.find((c) => c.getAttribute('data-cb-tip')?.includes('localization'))!;
    expect((unread as HTMLElement).style.borderStyle).toBe('dotted');
    expect(unread.getAttribute('data-cb-tip')).toContain('channels 1 and 7 could not be measured');
  });

  it('draws a bundle measured at ZERO, rather than dropping it', () => {
    // The projection declares a row for every bundle, including one whose
    // quiet tail is 0. Dropping it would make "looked, found none" look
    // exactly like "never mentioned" - the one mistake this page exists to
    // prevent, applied to its own band.
    const p = plan();
    p.quiet = [
      { domain: 'software-engineering', subjects: 3, demandKnown: true },
      { domain: 'agent-operations', subjects: 0, demandKnown: true },
    ];
    const model = buildModel(p);
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <Bands model={model} />
      </BlueprintWordsProvider>,
    );
    const chips = [...container.querySelectorAll('[data-role="cb-band-row"] .cb-chip')];
    expect(chips).toHaveLength(2);
    const zero = chips.find((c) => c.textContent?.includes('AO'))!;
    expect(zero).toBeDefined();
    expect(zero.textContent).toContain('0');
    expect(zero.getAttribute('data-cb-tip')).toContain('measured zero');
  });

  it('still draws the band when every bundle is measured at zero', () => {
    const p = plan();
    p.quiet = [{ domain: 'software-engineering', subjects: 0, demandKnown: true }];
    p.run.corpus.subjects = 2;
    const model = buildModel(p);
    expect(model.quietSubjects).toBe(0);
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <Bands model={model} />
      </BlueprintWordsProvider>,
    );
    expect(container.querySelectorAll('[data-role="cb-band-row"]')).toHaveLength(1);
  });

  it('draws no band at all when the projection declares no tail', () => {
    const p = plan();
    p.quiet = [];
    p.run.corpus.subjects = 2;
    const model = buildModel(p);
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <Bands model={model} />
      </BlueprintWordsProvider>,
    );
    expect(container.querySelectorAll('[data-role="cb-band-row"]')).toHaveLength(0);
  });

  it('draws the unlisted remainder as unknown columns, never as zeros', () => {
    const p = plan();
    p.run.corpus.subjects = 10;
    const model = buildModel(p);
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <Bands model={model} />
      </BlueprintWordsProvider>,
    );
    const unlisted = container.querySelector('[data-role="cb-band-row"]')!;
    expect(unlisted.textContent).toContain('4');
    expect(unlisted.querySelectorAll('.cb-unkbox')).toHaveLength(9);
    expect(unlisted.querySelectorAll('.cb-flat')).toHaveLength(0);
  });

  /**
   * The band's title and its note are two sentences, and the reader must be
   * able to tell where one ends.
   *
   * They ran together on screen for as long as the page has existed - "46 more
   * scoring subjectsmeasured, not carried by this plan" - because `.cb-sl`'s
   * `display:flex` was declared on `.cb-row .cb-sl` and a band row is
   * `.cb-lrow.cb-band`, never `.cb-row`. jsdom computes no layout, so this
   * asserts the STRUCTURE that makes the separation possible: the two strings
   * are separate element children of the cell, which is what a flex or a block
   * container both need and what a bare text-node concatenation does not give.
   */
  it('keeps a band title and its note as two separate elements', () => {
    const p = plan();
    p.run.corpus.subjects = 10;
    const model = buildModel(p);
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <Bands model={model} />
      </BlueprintWordsProvider>,
    );
    const cell = container.querySelector('[data-role="cb-band-row"] .cb-sl')!;
    const texts = [...cell.children].map((c) => (c.textContent ?? '').trim()).filter(Boolean);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(
      interpolate(en.companions.blueprint.band_unlisted_title, { n: '4' }),
    );
    expect(texts[1]).toBe(en.companions.blueprint.band_unlisted_note);
    // Nothing outside those two elements: a bare text node here is a string
    // that would abut its neighbour with no element boundary to separate it.
    expect([...cell.childNodes].filter((n) => n.nodeType === 3 && n.textContent?.trim())).toHaveLength(0);
  });
});
