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

  it('draws no band at all when the tail is empty', () => {
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
});
