/**
 * The Conversations rail (WP12, the owner's V1): ONE Needs you queue with the
 * rail's one lamp, decided with the deck's keys, and Drive turning it to the
 * deliberation's controls.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

const t = new Proxy({}, { get: (_o, section) => new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }) });
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }) }));
vi.mock('@/features/teams/sub_teamWorkspace/teamStudio/boardShared', () => ({ usePersonaIndex: () => new Map() }));
vi.mock('../DeliberationRail', () => ({
  DeliberationRail: ({ deliberationId }: { deliberationId: string }) => <div data-testid="delib-controls">{deliberationId}</div>,
}));

import { ConversationRail, type RailTab } from '../ConversationRail';
import { useRailFocus } from '../useRailFocus';
import type { Ask, QuestionAsk, ReviewAsk } from '../needsYouModel';
import type { PendingAsks } from '../usePendingAsks';

const review = (id: string, over: Partial<ReviewAsk> = {}): ReviewAsk => ({
  kind: 'review', id, personaId: 'p1', title: `Review ${id}`, body: null, tier: 2, at: '2026-10-16T08:00:00Z', actions: [], executionId: null, ...over,
});
const question = (id: string): QuestionAsk => ({
  kind: 'question', id, personaId: 'p1', title: `Question ${id}`, tier: 2, at: null, sessionId: 's1', cellKey: id,
  options: ['Operators', 'Developers'], complex: false,
});

function pending(over: Partial<PendingAsks> = {}): PendingAsks {
  return {
    asks: [], readable: true, loading: false, error: null, busy: false, refresh: vi.fn(),
    approve: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined),
    branch: vi.fn().mockResolvedValue(undefined), answer: vi.fn().mockResolvedValue(undefined), ...over,
  };
}

function mount(asks: Ask[], p = pending(), tab: RailTab = 'asks', focusDelib: string | null = null) {
  return render(
    <ConversationRail tab={tab} onTab={() => undefined} asks={asks} pending={p} personaScoped={false} teamId="t1" focusDelib={focusDelib} />,
  );
}
const press = (key: string, code?: string) => act(() => { fireEvent.keyDown(window, { key, code: code ?? `Key${key.toUpperCase()}` }); });

describe('ConversationRail: Needs you', () => {
  it('lights the one lamp with the count of reviews AND questions while anything waits', () => {
    const { container } = mount([review('r1'), question('q1')]);
    expect(container.querySelector('.ae-plate')).not.toBeNull();
    expect(container.querySelector('.ae-lamp.is-lit')).not.toBeNull();
    expect(screen.getByRole('tab', { name: /2/ })).toBeTruthy();
    expect(screen.getByTestId('ask-head').textContent).toContain('Review r1');
    expect(screen.getAllByTestId('ask-row').map((r) => r.textContent)).toEqual(['Question q1']);
  });

  it('stays dark when nothing waits, and while the queue is unread or unreadable', () => {
    const cases: Array<[Ask[], PendingAsks]> = [
      [[], pending()],
      [[review('r1')], pending({ readable: false, loading: true })],
      [[review('r1')], pending({ readable: false, error: 'boom' })],
    ];
    for (const [asks, p] of cases) {
      const { container, unmount } = mount(asks, p);
      expect(container.querySelector('.ae-lamp.is-lit')).toBeNull();
      unmount();
    }
  });

  it('A approves the ask in hand; S leaves it for later and brings the next one into hand', () => {
    const p = pending();
    mount([review('r1'), review('r2', { at: '2026-10-16T09:00:00Z' })], p);
    press('s');
    expect(screen.getByTestId('ask-head').textContent).toContain('Review r2');
    press('a');
    expect(p.approve).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
  });

  it('R asks why first; Enter with nothing typed rejects without a reason', () => {
    const p = pending();
    mount([review('r1')], p);
    press('r');
    expect(p.reject).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(p.reject).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), undefined);
  });

  it('a digit takes a branch: a suggested action, or a question option', () => {
    const p = pending();
    const first = mount([review('r1', { actions: ['Merge after one more CI run'] })], p);
    press('1', 'Digit1');
    expect(p.branch).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'Merge after one more CI run');
    first.unmount();
    mount([question('q1')], p);
    press('2', 'Digit2');
    expect(p.answer).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }), 'Developers');
  });

  it('keys never fire while the operator types in a field', () => {
    const p = pending();
    mount([review('r1')], p);
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    act(() => { fireEvent.keyDown(input, { key: 'a', code: 'KeyA' }); });
    expect(p.approve).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('Drive switches the rail', () => {
  it('Drive turns the rail to that deliberation; a new scope puts it back on Needs you', () => {
    const { result, rerender } = renderHook(({ scope }) => useRailFocus(scope), { initialProps: { scope: 't1' } });
    expect(result.current.tab).toBe('asks');
    act(() => result.current.drive('dl-1'));
    expect(result.current).toMatchObject({ tab: 'focus', focusDelib: 'dl-1' });
    rerender({ scope: 't2' });
    expect(result.current).toMatchObject({ tab: 'asks', focusDelib: null });
  });

  it('the Deliberation tab shows the driven deliberation controls, not the dock', () => {
    mount([review('r1')], pending(), 'focus', 'dl-1');
    expect(screen.getByTestId('delib-controls').textContent).toBe('dl-1');
    expect(screen.queryByTestId('ask-dock')).toBeNull();
  });
});
