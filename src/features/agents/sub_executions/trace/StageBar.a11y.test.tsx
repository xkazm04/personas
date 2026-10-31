/**
 * The waterfall's stage disclosure toggle was an icon-only button with no
 * accessible name and no expanded state, so a screen reader announced
 * "button" beside each stage with sub-spans and could not say whether the
 * tool calls under it were showing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { StageBar } from './StageBar';
import { STAGE_META } from '@/lib/execution/pipeline';
import type { UnifiedSpan } from '@/lib/execution/pipeline';

const span = {
  span_id: 's1', parent_span_id: null, span_type: 'stream_output', name: 'stream_output',
  start_ms: 0, end_ms: 100, duration_ms: 100, cost_usd: null, error: null, metadata: null,
} as unknown as UnifiedSpan;

describe('StageBar disclosure toggle', () => {
  it('names the toggle and states whether it is expanded', () => {
    const { rerender } = render(
      <StageBar entry={span} totalDurationMs={100} isExpanded={false} onToggle={() => {}} hasSubSpans />,
    );
    const toggle = screen.getByRole('button', { name: STAGE_META.stream_output.label });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    rerender(<StageBar entry={span} totalDurationMs={100} isExpanded onToggle={() => {}} hasSubSpans />);
    expect(screen.getByRole('button', { name: STAGE_META.stream_output.label }).getAttribute('aria-expanded')).toBe('true');
  });
});
