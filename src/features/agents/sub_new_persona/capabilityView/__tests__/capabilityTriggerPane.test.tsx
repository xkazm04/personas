/**
 * The capability row's Trigger pane edits. sweep #278.
 *
 * It was the one read-only pane in the set - and the row's DEFAULT tab - so the
 * first thing a user saw on expanding a capability was a definition list, or,
 * before the build proposed anything, the bare word "pending". Its siblings
 * (Connectors, Policies) have patched the capability all along.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { CapabilityState } from '@/lib/types/buildTypes';
import { useAgentStore } from '@/stores/agentStore';
import { CapabilityTriggerPane } from '../panes/CapabilityTriggerPane';

function capability(overrides: Partial<CapabilityState> = {}): CapabilityState {
  return {
    id: 'cap-1',
    title: 'Daily digest',
    capability_summary: 'Sends a digest',
    resolvedFields: {},
    ...overrides,
  };
}

let patched: Array<[string, Partial<CapabilityState>]> = [];

beforeEach(() => {
  patched = [];
  useAgentStore.setState({
    patchCapability: ((id: string, partial: Partial<CapabilityState>) => {
      patched.push([id, partial]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  });
});

function lastPatch(): Partial<CapabilityState> {
  const entry = patched.at(-1);
  if (!entry) throw new Error('no patch recorded');
  return entry[1];
}

describe('CapabilityTriggerPane', () => {
  it('offers the type picker instead of a bare "pending" when nothing is proposed', () => {
    render(<CapabilityTriggerPane capability={capability()} />);
    expect(screen.getByTestId('capability-trigger-type-schedule-cap-1')).toBeInTheDocument();
    expect(screen.getByTestId('capability-trigger-empty-cap-1')).toBeInTheDocument();
  });

  it('creates a trigger from the picker and marks the field resolved', () => {
    render(<CapabilityTriggerPane capability={capability()} />);
    fireEvent.click(screen.getByTestId('capability-trigger-type-schedule-cap-1'));
    const patch = lastPatch();
    expect(patch.suggested_trigger).toMatchObject({ trigger_type: 'schedule' });
    // The row's progress counter must not keep calling this pending after a
    // human answered it.
    expect(patch.resolvedFields?.suggested_trigger).toBe('resolved');
  });

  it('edits the cron of a schedule trigger', () => {
    render(
      <CapabilityTriggerPane
        capability={capability({
          suggested_trigger: { trigger_type: 'schedule', config: { cron: '0 9 * * *' } },
        })}
      />,
    );
    const input = screen.getByTestId('capability-trigger-cron-cap-1');
    expect(input).toHaveValue('0 9 * * *');
    fireEvent.change(input, { target: { value: '30 7 * * 1' } });
    expect(lastPatch().suggested_trigger).toMatchObject({ config: { cron: '30 7 * * 1' } });
  });

  it('writes a polling interval as a number, not a string', () => {
    render(
      <CapabilityTriggerPane
        capability={capability({ suggested_trigger: { trigger_type: 'polling', config: {} } })}
      />,
    );
    fireEvent.change(screen.getByTestId('capability-trigger-interval-cap-1'), {
      target: { value: '300' },
    });
    const cfg = lastPatch().suggested_trigger?.config ?? {};
    expect(cfg.interval_seconds).toBe(300);
  });

  it('drops schedule-shaped config when the type changes, keeping what survives', () => {
    render(
      <CapabilityTriggerPane
        capability={capability({
          suggested_trigger: {
            trigger_type: 'schedule',
            config: { cron: '0 9 * * *', timezone: 'UTC' },
            description: 'morning digest',
          },
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('capability-trigger-type-polling-cap-1'));
    const next = lastPatch().suggested_trigger;
    expect(next?.trigger_type).toBe('polling');
    // A cron on a polling trigger is dead config the backend would ignore.
    expect(next?.config?.cron).toBeUndefined();
    expect(next?.config?.timezone).toBe('UTC');
    expect(next?.description).toBe('morning digest');
  });

  it('shows the schedule in prose beside the raw cron', () => {
    render(
      <CapabilityTriggerPane
        capability={capability({
          suggested_trigger: { trigger_type: 'schedule', config: { cron: '0 9 * * *' } },
        })}
      />,
    );
    // humanizeCron is the same helper the collapsed chip uses; the assertion is
    // only that the raw expression is not the only thing on screen.
    expect(screen.getByTestId('capability-trigger-pane-cap-1').textContent).not.toBe(null);
    expect(screen.getByTestId('capability-trigger-pane-cap-1').textContent).toMatch(/9|09/);
  });

  it('never patches on mere render - only on a user action', () => {
    render(<CapabilityTriggerPane capability={capability()} />);
    expect(patched).toHaveLength(0);
  });
});
