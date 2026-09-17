/**
 * The calendar chip must answer "why didn't this fire?" without a new surface.
 *
 * EventTooltip already rendered exact time, slot kind, the unverified copy and
 * the overlap partners - and was imported by nothing, so every chip on the
 * week and month grids was an unlabelled coloured box. These cases pin the
 * four disclosures to the chip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EventBlock } from '../../components/EventBlock';
import type { CalendarEvent, ConflictGroup } from '../calendarHelpers';
import en from '@/i18n/locales/en.json';

// The shared Tooltip opens after MOTION.delay.tooltip.default, so the clock is
// driven rather than waited on.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const at = new Date(2026, 8, 15, 9, 30);

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1',
  agentId: 'a1',
  agentName: 'Digest Bot',
  agentIcon: null,
  agentColor: null,
  triggerId: 't1',
  time: at,
  kind: 'past-unknown',
  ...over,
});

const group = (...events: CalendarEvent[]): ConflictGroup => ({ events, windowStart: at });

function showTooltip(event: CalendarEvent, conflictGroup?: ConflictGroup) {
  render(
    <EventBlock event={event} color="#3B82F6" compact={false} conflictGroup={conflictGroup} onClick={() => {}} />,
  );
  // Keyboard focus, not just hover - a chip nobody can tab to discloses nothing.
  fireEvent.focusIn(screen.getByRole('button'));
  act(() => { vi.runAllTimers(); });
  return screen.getByTestId('event-tooltip');
}

describe('EventBlock disclosure', () => {
  it('discloses the exact local time of the slot', () => {
    const text = showTooltip(ev()).textContent ?? '';
    expect(text).toContain(
      at.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('discloses the slot kind', () => {
    expect(showTooltip(ev()).textContent).toContain(en.schedules.unverified);
  });

  it('explains a past-unknown slot rather than leaving a dashed chip', () => {
    expect(showTooltip(ev()).textContent).toContain(en.schedules.unverified_tooltip);
  });

  it('names the overlap partners, excluding the chip itself', () => {
    const self = ev();
    const other = ev({ id: 'e2', triggerId: 't2', agentName: 'Standup Bot' });
    const text = showTooltip(self, group(self, other)).textContent ?? '';
    expect(text).toContain(en.schedules.overlaps_with);
    expect(text).toContain('Standup Bot');
    // The chip's own agent is not listed as its own overlap partner.
    expect(text.split(en.schedules.overlaps_with)[1]).not.toContain('Digest Bot');
  });

  it('shows no overlap line when the slot stands alone', () => {
    expect(showTooltip(ev({ kind: 'projected' })).textContent).not.toContain(en.schedules.overlaps_with);
  });

  it('still fires its click handler', () => {
    let clicked = 0;
    render(<EventBlock event={ev()} color="#3B82F6" compact onClick={() => { clicked += 1; }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(clicked).toBe(1);
  });
});
