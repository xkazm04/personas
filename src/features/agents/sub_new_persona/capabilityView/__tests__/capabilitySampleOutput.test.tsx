/**
 * The capability row's field list and the build session's gate list are two
 * implementations of one rule. `gates.rs` GATED_CAPABILITY_FIELDS has five
 * entries; TRACKED_FIELDS had the four event/policy-side ones and omitted
 * `sample_output`, so a capability reported 6/6 resolved while the session was
 * still Pending on output shape and the wizard advertised a completeness the
 * quality gate would refuse.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TRACKED_FIELDS, resolutionProgress } from '../capabilityHelpers';
import { CapabilityRowTabs } from '../CapabilityRowTabs';
import type { CapabilityState } from '@/lib/types/buildTypes';

/** The Rust list, copied here so a drift in either direction is visible. */
const GATED_CAPABILITY_FIELDS = [
  'suggested_trigger',
  'connectors',
  'review_policy',
  'memory_policy',
  'sample_output',
];

/** The two lanes the gates do not cover. */
const EVENT_LANE_FIELDS = ['notification_channels', 'event_subscriptions'];

function capability(overrides: Partial<CapabilityState> = {}): CapabilityState {
  return {
    id: 'cap-1',
    title: 'Daily digest',
    capability_summary: 'Sends a digest',
    resolvedFields: {},
    ...overrides,
  };
}

describe('capability sample_output parity', () => {
  it('tracks exactly the gated fields plus the two event-lane fields', () => {
    expect([...TRACKED_FIELDS].sort()).toEqual(
      [...GATED_CAPABILITY_FIELDS, ...EVENT_LANE_FIELDS].sort(),
    );
    expect(TRACKED_FIELDS).toContain('sample_output');
  });

  it('does not report full resolution while the output shape is pending', () => {
    const resolvedExceptOutput: CapabilityState['resolvedFields'] = {};
    for (const f of TRACKED_FIELDS) {
      resolvedExceptOutput[f] = f === 'sample_output' ? 'pending' : 'resolved';
    }
    const { resolved, total } = resolutionProgress(
      capability({ resolvedFields: resolvedExceptOutput }),
    );
    expect(total).toBe(7);
    expect(resolved).toBe(6);
  });

  it('renders a Sample output tab carrying the gate state', () => {
    render(<CapabilityRowTabs capability={capability()} />);
    const tab = screen.getByTestId('capability-tab-sampleOutput-cap-1');
    expect(tab).toBeInTheDocument();
    expect(tab.getAttribute('data-resolved')).toBe('false');
  });

  it('marks the tab resolved once the output-shape gate has an answer', () => {
    render(
      <CapabilityRowTabs
        capability={capability({
          resolvedFields: { sample_output: 'resolved' },
          sample_output: { format: 'markdown' },
        })}
      />,
    );
    expect(
      screen.getByTestId('capability-tab-sampleOutput-cap-1').getAttribute('data-resolved'),
    ).toBe('true');
  });
});
