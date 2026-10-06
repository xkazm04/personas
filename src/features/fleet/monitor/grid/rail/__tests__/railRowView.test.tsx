/**
 * The rail row after the Board fuse (2026-10-05): it wears the Board rail's
 * row, and keeps everything it did. Pinned here:
 *
 *  (a) TONE has one authority per meaning: a review is a persona needing you
 *      and reads the Board's critical/warning by severity (`piles.needTone`'s
 *      rule); every other kind keeps the deck's kind tone, painted through the
 *      same `--fb-tone` the skin's bar and ink read.
 *  (b) The FACE is the persona the item names, from the roster first (a
 *      question names its persona only in the payload), else none - and then
 *      the kind glyph takes the face's slot.
 *  (c) The behaviours: `rail-row` on all three branches, a verdict never opens
 *      the row, the height the virtualizer reads is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import { makeItem, makeQuestion } from '@/features/agents/quick-answer/triage/__tests__/triageFixtures';
import { PILE_VISUAL } from '../../skin/piles';
import { ideaToRow, triageToRow } from '../railModel';
import { railToneVar } from '../RailBits';
import { RailRowView, railRowHeight, RAIL_ROW_HEIGHT } from '../RailRowView';

afterEach(cleanup);

const severity = (label: string) => [{ id: 'severity', label, tone: 'neutral' as const }];
const roster = new Map([
  ['persona-1', { id: 'persona-1', name: 'Scout', icon: 'agent-icon:code', color: '#06b6d4' } as Persona],
]);
const personaOf = (id: string) => roster.get(id);

describe('tone', () => {
  it('a review reads critical only when its severity is critical, warning otherwise', () => {
    expect(triageToRow(makeItem('review', { tags: severity('critical') }), 'Review').tone).toBe('danger');
    expect(triageToRow(makeItem('review', { tags: severity('high') }), 'Review').tone).toBe('warning');
    expect(triageToRow(makeItem('review', { tags: severity('medium') }), 'Review').tone).toBe('warning');
  });

  it('every other kind keeps the deck kind tone', () => {
    expect(triageToRow(makeItem('idea'), 'Idea').tone).toBe('accent');
    expect(triageToRow(makeItem('goal'), 'Goal').tone).toBe('success');
    expect(triageToRow(makeItem('evolution'), 'Evolution').tone).toBe('warning');
  });

  it('needs tones are the Board piles; the rest are the deck fill tokens', () => {
    expect(railToneVar('danger')).toBe(PILE_VISUAL.critical.tone);
    expect(railToneVar('warning')).toBe(PILE_VISUAL.warning.tone);
    expect(railToneVar('accent')).toBe('var(--primary)');
    expect(railToneVar('success')).toBe('var(--status-success)');
    expect(railToneVar('neutral')).toBe('var(--foreground)');
  });
});

describe('face', () => {
  it('resolves the persona from the roster, including a payload-only id', () => {
    const row = triageToRow(makeQuestion(), 'Question', personaOf);
    expect(row.persona).toEqual({ icon: 'agent-icon:code', color: '#06b6d4', name: 'Scout' });
  });

  it('falls back to the icon the item carries, and to none', () => {
    const carried = makeItem('review', { personaIcon: 'agent-icon:email', source: { label: 'Mailer', color: '#a855f7' } });
    expect(triageToRow(carried, 'Review', personaOf).persona).toEqual({ icon: 'agent-icon:email', color: '#a855f7', name: 'Mailer' });
    expect(triageToRow(makeItem('idea'), 'Idea', personaOf).persona).toBeNull();
  });
});

describe('RailRowView', () => {
  it('keeps the height the virtualizer reads', () => {
    expect(RAIL_ROW_HEIGHT).toBe(56);
    expect(railRowHeight(triageToRow(makeItem('idea'), 'Idea'))).toBe(RAIL_ROW_HEIGHT);
  });

  it('a verdict decides without opening the row', () => {
    const onOpen = vi.fn();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const row = triageToRow(makeItem('review', { tags: severity('critical') }), 'Review');
    const { getByTestId } = render(<RailRowView row={row} onOpen={onOpen} onAccept={onAccept} onReject={onReject} />);
    fireEvent.click(getByTestId('rail-row-accept'));
    fireEvent.click(getByTestId('rail-row-reject'));
    expect(onAccept).toHaveBeenCalledWith(row.id);
    expect(onReject).toHaveBeenCalledWith(row.id);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId('rail-row'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(row);
  });

  it('paints the tone through --fb-tone and carries rail-row on every branch', () => {
    const review = triageToRow(makeItem('review', { tags: severity('critical') }), 'Review');
    const idea = ideaToRow({ id: 'i1', title: 'T', projectName: 'Ledger', acceptedAt: '2026-09-01T00:00:00Z' } as never, 'Dispatch');
    const opened = render(<RailRowView row={review} onOpen={() => {}} />).getByTestId('rail-row');
    expect(opened.getAttribute('role')).toBe('button');
    expect(opened.style.getPropertyValue('--fb-tone')).toBe(PILE_VISUAL.critical.tone);
    cleanup();
    const label = render(<RailRowView row={idea} selected onToggle={() => {}} />).getByTestId('rail-row');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toContain('is-lit');
    cleanup();
    expect(render(<RailRowView row={idea} />).getByTestId('rail-row').tagName).toBe('DIV');
  });
});
