import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { CockpitWidgetProps } from '../../widgetRegistry';
import { IssueListWidget } from '../IssueListWidget';
import { FlowStepsWidget } from '../FlowStepsWidget';
import { LogExcerptWidget } from '../LogExcerptWidget';
import { TimelineWidget } from '../TimelineWidget';
import { ComparisonCardsWidget } from '../ComparisonCardsWidget';
import { StatGridWidget } from '../StatGridWidget';
import { BrowserTestReportWidget } from '../BrowserTestReportWidget';
import { WidgetBoundary } from '../../panel/WidgetBoundary';

vi.mock('@/api/devTools/devTools', () => ({ completeGoalUat: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/api/companion', () => ({ companionFileBrowserDefects: vi.fn() }));

// Athena composes these configs; a model emits `{ text }` objects, strings for arrays, numbers for
// strings. Every case here threw "Objects are not valid as a React child" before the widgets
// narrowed their config at the boundary.
const cases: [string, ComponentType<CockpitWidgetProps>, Record<string, unknown>][] = [
  ['issue_list', IssueListWidget, { items: [{ id: 'a', title: { text: 'x' } }, { id: { n: 1 }, title: 'ok', sublabel: { s: 1 } }] }],
  ['flow_steps', FlowStepsWidget, { steps: [{ label: { text: 'x' } }, { label: 'ok', detail: { d: 1 }, status: 'done' }] }],
  ['log_excerpt', LogExcerptWidget, { lines: [{ text: 'x' }, 'ok', null], caption: { c: 1 }, source: { s: 1 } }],
  ['timeline', TimelineWidget, { events: [{ label: { text: 'x' } }, { label: 'ok', detail: { d: 1 }, timestamp: { t: 1 } }] }],
  ['comparison_cards', ComparisonCardsWidget, { options: [{ label: 'A', pros: 'one string', cons: [{ x: 1 }] }, { label: { l: 1 } }] }],
  ['stat_grid', StatGridWidget, { stats: [{ label: { l: 1 }, value: 3 }, 'junk', null] }],
  ['browser_test_report', BrowserTestReportWidget, { steps: [{ label: { l: 1 }, result: 'pass' }], defects: [{ title: { t: 1 } }], console_errors: [{ e: 1 }] }],
];

describe('cockpit widgets narrow malformed model config', () => {
  it.each(cases)('%s does not throw on a malformed config', (_kind, Widget, config) => {
    expect(() => render(<Widget config={config} />)).not.toThrow();
  });

  it('keeps the well-formed items beside the malformed ones', () => {
    render(<IssueListWidget config={{ items: [{ id: 'a', title: { text: 'x' } }, { id: 'b', title: 'Keep me' }] }} />);
    expect(screen.getAllByText('Keep me').length).toBeGreaterThan(0);
  });
});

describe('WidgetBoundary', () => {
  it('degrades a throwing widget to an error tile instead of unmounting its siblings', () => {
    const Bomb = () => {
      throw new Error('boom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <WidgetBoundary kind="bomb" resetKey={1}><Bomb /></WidgetBoundary>
        <p>sibling</p>
      </div>,
    );
    spy.mockRestore();
    expect(screen.getByText('sibling')).toBeInTheDocument();
    expect(screen.getByText('bomb')).toBeInTheDocument();
  });
});
