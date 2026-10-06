import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { foldPulse, type ProjectPulse } from '../useProjectPulse';
import { AttentionCell, PulseCell } from '../ProjectPulseCells';

/**
 * The wall's honesty gate (sweep #45): a project nobody ever scanned must NOT
 * render the same "0" as a project that was swept and came back clean. Three
 * fixtures — busy, clean, never-scanned — and the third one is the whole point.
 */

const idea = (status: string, created_at: string) => ({ status, created_at });

describe('foldPulse', () => {
  it('reports null (not zero) for a project that never had an idea raised', () => {
    const pulse = foldPulse([]);
    expect(pulse.attention).toBeNull();
    expect(pulse.lastSignalAt).toBeNull();
    expect(pulse.truncated).toBe(false);
  });

  it('counts only pending findings and keeps the newest timestamp as the pulse', () => {
    const pulse = foldPulse([
      idea('pending', '2026-09-16T10:00:00Z'),
      idea('accepted', '2026-09-15T10:00:00Z'),
      idea('pending', '2026-09-14T10:00:00Z'),
      idea('rejected', '2026-09-13T10:00:00Z'),
    ]);
    expect(pulse.attention).toBe(2);
    expect(pulse.lastSignalAt).toBe('2026-09-16T10:00:00Z');
    expect(pulse.truncated).toBe(false);
  });

  it('reports a measured zero when the project was scanned and came back clean', () => {
    const pulse = foldPulse([idea('accepted', '2026-09-16T10:00:00Z')]);
    expect(pulse.attention).toBe(0);
    expect(pulse.lastSignalAt).toBe('2026-09-16T10:00:00Z');
  });

  it('flags truncation when the page came back full', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      idea('pending', `2026-09-0${(i % 9) + 1}T10:00:00Z`),
    );
    expect(foldPulse(many).truncated).toBe(true);
  });
});

const BUSY: ProjectPulse = { attention: 4, lastSignalAt: '2026-09-16T10:00:00Z', truncated: false };
const CLEAN: ProjectPulse = { attention: 0, lastSignalAt: '2026-09-16T10:00:00Z', truncated: false };

describe('AttentionCell', () => {
  it('paints the pending count for a project with findings', () => {
    render(<AttentionCell pulse={BUSY} />);
    expect(screen.getByTestId('project-attention-count')).toHaveTextContent('4');
    expect(screen.queryByTestId('project-attention-unknown')).toBeNull();
  });

  it('paints a measured zero for a scanned, clean project', () => {
    render(<AttentionCell pulse={CLEAN} />);
    expect(screen.getByTestId('project-attention-clear')).toHaveTextContent('0');
  });

  it('paints a mark with no number at all for a never-scanned project', () => {
    render(<AttentionCell pulse={undefined} />);
    const cell = screen.getByTestId('project-attention-unknown');
    // 2026-10-06: the em dash went. The invariant it was protecting is NOT the
    // dash - it is that an unmeasured project never renders a number, and never
    // renders as the measured-clean cell. Both are still asserted; the glyph
    // carries "unwatched" and the accessible name carries the words.
    expect(cell.textContent?.trim()).toBe('');
    expect(cell.textContent).not.toContain('0');
    expect(cell).toHaveAccessibleName();
    expect(screen.queryByTestId('project-attention-clear')).toBeNull();
  });

  it('marks a truncated count as a floor', () => {
    render(<AttentionCell pulse={{ ...BUSY, truncated: true }} />);
    expect(screen.getByTestId('project-attention-count')).toHaveTextContent('4+');
  });
});

describe('PulseCell', () => {
  it('renders a relative time when something was raised', () => {
    render(<PulseCell pulse={BUSY} />);
    expect(screen.getByTestId('project-pulse-at')).toBeTruthy();
    expect(screen.queryByTestId('project-pulse-never')).toBeNull();
  });

  it('marks never-scanned rather than showing a fresh-looking blank', () => {
    render(<PulseCell pulse={undefined} />);
    const cell = screen.getByTestId('project-pulse-never');
    expect(cell).toBeTruthy();
    // The words moved into the tooltip and the accessible name (2026-10-06);
    // what must never happen is this cell looking like a scanned one, so the
    // relative-time cell has to be absent and the name has to be present.
    expect(screen.queryByTestId('project-pulse-at')).toBeNull();
    expect(cell).toHaveAccessibleName();
  });
});
