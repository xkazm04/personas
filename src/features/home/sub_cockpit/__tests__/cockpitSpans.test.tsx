/**
 * The span contract (kit batch home-3). Every widget used to land at span 6 when the composer
 * said nothing, so a 1920 Cockpit was one column of full-width tiles with their content pinned
 * left (owner, 2026-10-03: "creating empty space"). A sensible span is a property of the KIND,
 * so the default lives beside the registry - and it stays a DEFAULT: Athena's spec always wins.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { WIDGET_DEFAULT_SPAN } from '../widgetRegistry';
import { CockpitGrid } from '../panel/CockpitGrid';
import { composeDefaultCockpit, type DefaultCockpitLabels } from '../defaultCockpit';

const LABELS: DefaultCockpitLabels = {
  title: 't', vitalsTitle: 'v', rosterTitle: 'r', attentionTitle: 'a', attentionEmpty: 'e',
  stat: { activePersonas: '1', successRate: '2', executions: '3', needsAttention: '4' },
  attentionReason: { setup: 's', disabled: 'd', low_trust: 'l' },
};

function spanOf(kind: string, span?: number): string | null {
  const { container } = render(
    <CockpitGrid label="g" widgets={[{ id: 'w', kind, span, config: {} } as never]} />,
  );
  return container.querySelector('.k-dtile')!.getAttribute('data-span');
}

describe('the cockpit span default', () => {
  it('a kind with a declared default takes it when the spec states no span', () => {
    expect(WIDGET_DEFAULT_SPAN.metric_spark).toBe(4);
    expect(WIDGET_DEFAULT_SPAN.stat_grid).toBe(12);
    expect(spanOf('metric_spark')).toBe('4');
    expect(spanOf('text_callout')).toBe('12');
  });

  it("the composer's own span always wins over the kind's default", () => {
    expect(spanOf('metric_spark', 12)).toBe('12');
    expect(spanOf('stat_grid', 6)).toBe('6');
  });

  it('a kind with no declared default keeps the old half-width fallback', () => {
    expect(WIDGET_DEFAULT_SPAN.issue_list).toBeUndefined();
    expect(spanOf('issue_list')).toBe('6');
  });

  it('an unknown kind still renders an error tile rather than a gap', () => {
    expect(spanOf('not_a_kind')).toBe('6');
  });

  it('the starter cockpit puts its two lists side by side instead of stacking two full bands', () => {
    const spec = composeDefaultCockpit([], null, LABELS);
    const span = (id: string) => spec.widgets.find((w) => w.id === id)!.span;
    expect(span('default-vitals')).toBe(12);
    expect(span('default-attention')).toBe(7);
    expect(span('default-roster')).toBe(5);
  });
});
