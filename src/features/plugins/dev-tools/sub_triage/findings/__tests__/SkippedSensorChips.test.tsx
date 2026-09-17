/**
 * `failure-not-empty-success`.
 *
 * A first sweep on an unwired project raises nothing and skips almost every
 * sensor. Before this, that rendered as: a success-coloured toast ending
 * "skipped: llm, sentry, passport", and a SensorScoreboard that returned `null`
 * because `stats.length === 0`. Two different situations - measured and clean,
 * versus never measured - produced the same screen.
 *
 * The assertions pin both halves: one chip per skipped sensor, and a scoreboard
 * that refuses to disappear while sensors went unread.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setDevToolsTab = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setDevToolsTab, ideas: [] }),
}));

import { SkippedSensorChips, SKIPPED_SENSOR_TABS } from '../SkippedSensorChips';
import { SensorScoreboard } from '../SensorScoreboard';
import { recordSweep, resetLastSweep, getLastSweep } from '../lastSweep';

const ALL_KEYS = ['llm', 'sentry', 'skills', 'docs', 'passport', 'memory'];

describe('SkippedSensorChips', () => {
  beforeEach(() => {
    setDevToolsTab.mockReset();
    resetLastSweep();
  });
  afterEach(() => resetLastSweep());

  it('renders one chip per skipped sensor, for every key the sweep can emit', () => {
    render(<SkippedSensorChips skipped={ALL_KEYS} />);
    for (const key of ALL_KEYS) {
      const wired = screen.queryByTestId(`skipped-sensor-wire-${key}`);
      const plain = screen.queryByTestId(`skipped-sensor-${key}`);
      expect(wired ?? plain, `no chip rendered for "${key}"`).toBeTruthy();
    }
  });

  it('a chip with a named destination navigates there', () => {
    render(<SkippedSensorChips skipped={['llm', 'sentry', 'skills']} />);

    fireEvent.click(screen.getByTestId('skipped-sensor-wire-llm'));
    expect(setDevToolsTab).toHaveBeenCalledWith('llm-overview');

    fireEvent.click(screen.getByTestId('skipped-sensor-wire-sentry'));
    expect(setDevToolsTab).toHaveBeenCalledWith('overview');

    fireEvent.click(screen.getByTestId('skipped-sensor-wire-skills'));
    expect(setDevToolsTab).toHaveBeenCalledWith('skills');
  });

  it('a sensor with no honest destination is SHOWN, not navigated and not hidden', () => {
    render(<SkippedSensorChips skipped={['docs', 'passport', 'memory']} />);
    for (const key of ['docs', 'passport', 'memory']) {
      expect(SKIPPED_SENSOR_TABS[key]).toBeNull();
      expect(screen.getByTestId(`skipped-sensor-${key}`)).toBeTruthy();
      expect(screen.queryByTestId(`skipped-sensor-wire-${key}`)).toBeNull();
    }
  });

  it('renders nothing when the sweep read everything', () => {
    render(<SkippedSensorChips skipped={[]} />);
    expect(screen.queryByTestId('skipped-sensor-chips')).toBeNull();
  });
});

describe('SensorScoreboard — a thin sweep is not a clean one', () => {
  beforeEach(() => resetLastSweep());
  afterEach(() => resetLastSweep());

  it('still renders itself when nothing was raised BUT sensors were skipped', () => {
    recordSweep('p1', ['llm', 'sentry']);
    render(<SensorScoreboard projectId="p1" />);
    expect(screen.getByTestId('sensor-scoreboard')).toBeTruthy();
    expect(screen.getByTestId('skipped-sensor-wire-llm')).toBeTruthy();
  });

  it('renders away when nothing was raised and nothing was skipped', () => {
    recordSweep('p1', []);
    render(<SensorScoreboard projectId="p1" />);
    expect(screen.queryByTestId('sensor-scoreboard')).toBeNull();
  });

  it("another project's sweep is not evidence about this one", () => {
    recordSweep('other-project', ['llm']);
    render(<SensorScoreboard projectId="p1" />);
    expect(screen.queryByTestId('sensor-scoreboard')).toBeNull();
    // The record still exists — it is scoped out, not thrown away.
    expect(getLastSweep()?.projectId).toBe('other-project');
  });
});
