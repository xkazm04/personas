import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Translations } from '@/i18n/en';
import { DimContent, isDimEmpty } from '../dimContent';
import { GLYPH_DIMENSIONS } from '../types';
import type { GlyphRow, GlyphDimension } from '../types';

/**
 * `isDimEmpty` and `DimContent` used to be two independent switches over the
 * same eight dimensions, with a comment asking the next editor to keep them in
 * sync by hand. They now read the row through one per-dim descriptor, and this
 * is the property that says so: for every dimension, in both directions,
 * `isDimEmpty` agrees with whether the renderer actually produced an empty
 * note. A future dim added to one switch and not the other fails here.
 */

/** Sentinel woven into every `empty_*` label so the assertion can ask "did the
 *  renderer fall through to an EmptyNote?" without depending on class names. */
const EMPTY_MARK = '<<empty>>';

const CHRONOLOGY_KEYS = [
  'empty_trigger', 'empty_steps', 'empty_connectors', 'empty_channels',
  'empty_review', 'empty_memory', 'empty_events', 'empty_error', 'empty_generic',
] as const;

// Named invariant: DimContent reads ONLY `t.templates.chronology`, and within
// it only the keys below (verified by reading the component). A full
// Translations object is ~thousands of keys; this stub is the slice the unit
// under test can observe, so the assertion is about rendering, not about i18n.
const t = {
  templates: {
    chronology: {
      show_less: 'less',
      show_n_more: '{count} more',
      trigger_manual: 'Manual',
      ...Object.fromEntries(CHRONOLOGY_KEYS.map((k) => [k, `${EMPTY_MARK} ${k}`])),
    },
  },
} as unknown as Translations;

const EMPTY_ROW: GlyphRow = {
  id: 'row-empty',
  title: 'Empty',
  enabled: true,
  triggers: [],
  connectors: [],
  steps: [],
  events: [],
  messageSummary: '',
  reviewSummary: '',
  memorySummary: '',
  errorSummary: '',
  presence: Object.fromEntries(
    GLYPH_DIMENSIONS.map((d) => [d, 'none']),
  ) as GlyphRow['presence'],
  shared: false,
};

const FULL_ROW: GlyphRow = {
  ...EMPTY_ROW,
  id: 'row-full',
  title: 'Full',
  triggers: [{ trigger_type: 'manual', description: 'on demand' }],
  connectors: [{ name: 'slack', label: 'Slack', purpose: 'post' }],
  steps: [{ id: 's1', label: 'Do the thing', detail: 'carefully' }],
  events: [{ event_type: 'run.finished', description: 'emitted at the end' }],
  messageSummary: 'slack: team channel',
  reviewSummary: 'Human approves before send.',
  memorySummary: 'Remembers the last five runs.',
  errorSummary: 'Retries twice, then alerts.',
};

function renderedEmpty(dim: GlyphDimension, row: GlyphRow): boolean {
  const { container, unmount } = render(<DimContent dim={dim} row={row} t={t} />);
  const sawEmptyNote = (container.textContent ?? '').includes(EMPTY_MARK);
  unmount();
  return sawEmptyNote;
}

describe('dimContent emptiness', () => {
  it('agrees with the renderer for every dimension on an empty row', () => {
    for (const dim of GLYPH_DIMENSIONS) {
      expect(isDimEmpty(dim, EMPTY_ROW), `isDimEmpty("${dim}") on an empty row`).toBe(true);
      expect(renderedEmpty(dim, EMPTY_ROW), `DimContent("${dim}") on an empty row`).toBe(true);
    }
  });

  it('agrees with the renderer for every dimension on a populated row', () => {
    for (const dim of GLYPH_DIMENSIONS) {
      expect(isDimEmpty(dim, FULL_ROW), `isDimEmpty("${dim}") on a populated row`).toBe(false);
      expect(renderedEmpty(dim, FULL_ROW), `DimContent("${dim}") on a populated row`).toBe(false);
    }
  });

  it('treats a dimension outside the vocabulary as empty', () => {
    // The generic branch renders an EmptyNote; emptiness must say the same.
    const unknownDim = 'not-a-dim' as GlyphDimension;
    expect(isDimEmpty(unknownDim, FULL_ROW)).toBe(true);
    expect(renderedEmpty(unknownDim, FULL_ROW)).toBe(true);
  });
});
