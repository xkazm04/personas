import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import type { ContextualCockpit } from '@/stores/slices/system/uiSlice';

import { cockpitHeading } from '../panel/CockpitHeader';

// The English catalog is the type the component reads through `t`.
const c = en.overview.cockpit as Parameters<typeof cockpitHeading>[0];
const body = { title: 'Ops landing', widgets: [] };

const overlay = (source: ContextualCockpit['source']): ContextualCockpit => ({ source, spec: body });

describe('cockpitHeading', () => {
  it('puts the composed title on the dominant line and the provenance above it', () => {
    expect(cockpitHeading(c, 'composed', body, null)).toEqual({ eyebrow: c.subtitle_composed, heading: 'Ops landing' });
  });

  it('names the starter cockpit and keeps its explanation in the hint, off the surface', () => {
    const h = cockpitHeading(c, 'default', { title: c.default_title, widgets: [] }, null);
    expect(h.heading).toBe(c.default_title);
    expect(h.hint).toBe(c.default_subtitle);
    expect(h.eyebrow).not.toBe(h.heading);
  });

  it('does not guess a title while the spec is loading', () => {
    expect(cockpitHeading(c, 'loading', null, null).heading).toBe(' ');
  });

  it('names a message overlay once: the spec title, with the overlay explanation as the hint', () => {
    const h = cockpitHeading(c, 'contextual', body, overlay({ kind: 'message', messageId: 'm', messageTitle: 'Nightly run' }));
    expect(h).toEqual({ eyebrow: c.title_default, heading: 'Ops landing', hint: c.subtitle_contextual });
  });

  it('falls back to the decision title for an untitled explain overlay', () => {
    const h = cockpitHeading(c, 'contextual', { widgets: [] }, overlay({ kind: 'explain', decisionId: 'd', decisionTitle: 'Why it failed' }));
    expect(h.heading).toBe('Why it failed');
    expect(h.hint).toBe(c.subtitle_explaining);
  });

  it('dates a briefing and says in the hint who composed it', () => {
    const src = { kind: 'briefing', generatedAt: '2026-09-28T07:00:00Z' } as const;
    const fallback = cockpitHeading(c, 'contextual', body, overlay({ ...src, composedBy: 'fallback' }), 'en');
    expect(fallback.hint).toBe(c.briefing_subtitle_fallback);
    expect(fallback.eyebrow).toMatch(/Sep/);
    expect(cockpitHeading(c, 'contextual', body, overlay({ ...src, composedBy: 'athena' }), 'en').hint).toBe(c.briefing_subtitle_athena);
  });
});
