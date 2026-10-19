/**
 * Feed payloads arrive from the shared-events catalog and are stored verbatim
 * (shared_event_firings.payload). The renderer trusted their shape through a
 * cast, so one malformed field took the whole Watchtower row or history modal
 * down: `tags.map` on a string, an object rendered as a React child.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import type { SharedEventFeedActivity } from '@/lib/bindings/SharedEventFeedActivity';
import { LastChangeCell, parseChangePayload } from '../sharedEventsUi';

describe('parseChangePayload', () => {
  it('keeps well-typed fields', () => {
    const p = parseChangePayload(
      JSON.stringify({ summary: 'New v2 endpoint', tags: ['api', 'breaking'], severity: 'major', docs_url: 'https://x.dev' }),
    );
    expect(p).toEqual({ summary: 'New v2 endpoint', tags: ['api', 'breaking'], severity: 'major', docs_url: 'https://x.dev' });
  });

  it('drops fields whose type is not what the renderer reads', () => {
    const p = parseChangePayload(
      JSON.stringify({ summary: { text: 'x' }, tags: 'breaking', severity: 3, docs_url: 42, label: null }),
    );
    expect(p).toEqual({});
  });

  it('keeps only the string entries of a mixed tags array', () => {
    expect(parseChangePayload(JSON.stringify({ tags: ['a', 1, null, 'b'] })).tags).toEqual(['a', 'b']);
  });

  it('returns nothing for an array or non-JSON payload', () => {
    expect(parseChangePayload('[1,2]')).toEqual({});
    expect(parseChangePayload('not json')).toEqual({});
  });
});

describe('LastChangeCell with a malformed payload', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  it('renders instead of throwing on an object summary', () => {
    const activity: SharedEventFeedActivity = {
      slug: 'stripe-api',
      lastFiredAt: '2026-10-01T10:00:00Z',
      lastPayload: JSON.stringify({ summary: { html: '<b>x</b>' }, severity: 'major' }),
      changeCount: 1n,
    };
    expect(() =>
      render(<LastChangeCell activity={activity} showSummary />),
    ).not.toThrow();
  });
});
