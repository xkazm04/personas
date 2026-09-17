/**
 * The Activity board's queue cursor.
 *
 * The board paints hundreds of tiles and six of them want the operator this
 * morning. Every tile was already focusable, so what was missing was the ORDER
 * — and the one property that makes the key worth pressing is that it SKIPS the
 * idle tiles sitting between two actionable ones, which is exactly what a
 * generic roving-focus implementation would not do.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, fireEvent } from '@testing-library/react';
import type { PersonaCardModel } from '../../monitorModel';
import type { BoardModel } from '../useBoardModel';
import {
  attentionOrder, stepAttention, swallowsKeys, useAttentionCursor, TILE_ID_ATTR,
} from '../useAttentionCursor';

function card(personaId: string, actionable: boolean): PersonaCardModel {
  return {
    personaId, personaName: personaId, personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    messages: [], processes: [],
    running: 0, queued: 0, inputRequired: actionable ? 1 : 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
  } as PersonaCardModel;
}

/** Two columns with idle tiles BETWEEN the actionable ones, plus a tray. */
function board(): BoardModel {
  return {
    columns: [
      { teamId: 't1', teamName: 'T1', teamColor: '#fff', cards: [card('a', true), card('i1', false), card('b', true)], rows: [] },
      { teamId: 't2', teamName: 'T2', teamColor: '#fff', cards: [card('i2', false), card('c', true)], rows: [] },
    ],
    ungrouped: [card('i3', false), card('d', true)],
    traySessions: [],
    totals: { running: 0, attention: 4, failed: 0, idle: 3 },
    empty: false,
    filtered: false,
  } as unknown as BoardModel;
}

const ORDER = ['a', 'b', 'c', 'd'];

describe('attentionOrder', () => {
  it('lists the actionable tiles in board order and nothing else', () => {
    expect(attentionOrder(board())).toEqual(ORDER);
  });

  it('is empty on a quiet board rather than falling back to every tile', () => {
    const quiet = { ...board(), columns: [], ungrouped: [card('i', false)] } as unknown as BoardModel;
    expect(attentionOrder(quiet)).toEqual([]);
  });
});

describe('stepAttention', () => {
  it('walks forward and wraps at the end', () => {
    let at: string | null = null;
    const visited: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      at = stepAttention(ORDER, at, 1);
      visited.push(at!);
    }
    // Four actionable, then back to the first: a queue is a ring.
    expect(visited).toEqual(['a', 'b', 'c', 'd', 'a']);
  });

  it('walks back and wraps at the start', () => {
    expect(stepAttention(ORDER, 'a', -1)).toBe('d');
    expect(stepAttention(ORDER, null, -1)).toBe('d');
  });

  it('restarts from the top when the cursor card has left the board', () => {
    // Answered, or filtered away: guessing where it would have been is worse
    // than starting over somewhere the operator can see.
    expect(stepAttention(ORDER, 'gone', 1)).toBe('a');
  });

  it('has nowhere to go on an empty queue', () => {
    expect(stepAttention([], 'a', 1)).toBeNull();
  });
});

describe('swallowsKeys', () => {
  it('yields to a field and to a dialog', () => {
    const input = document.createElement('input');
    expect(swallowsKeys(input)).toBe(true);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.appendChild(inner);
    expect(swallowsKeys(inner)).toBe(true);
  });

  it('does not yield to an ordinary button', () => {
    expect(swallowsKeys(document.createElement('button'))).toBe(false);
  });
});

describe('useAttentionCursor', () => {
  function mountTiles(ids: string[]) {
    return render(
      <div>
        {ids.map((id) => (
          <button key={id} type="button" {...{ [TILE_ID_ATTR]: id }} data-testid={`tile-${id}`} />
        ))}
      </div>,
    );
  }

  it('focuses only actionable tiles, skipping the idle ones between them', () => {
    const m = board();
    mountTiles(['a', 'i1', 'b', 'i2', 'c', 'i3', 'd']);
    const cards = [...m.columns.flatMap((c) => c.cards), ...m.ungrouped];
    renderHook(() => useAttentionCursor(m, cards, vi.fn()));

    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(window, { key: 'n' });
      seen.push(document.activeElement?.getAttribute(TILE_ID_ATTR) ?? '?');
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'a']);
  });

  it('opens the focused card on Enter, on its primary section', () => {
    const m = board();
    mountTiles(['a', 'b', 'c', 'd']);
    const cards = [...m.columns.flatMap((c) => c.cards), ...m.ungrouped];
    const onSelect = vi.fn();
    renderHook(() => useAttentionCursor(m, cards, onSelect));

    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // `inputRequired` resolves to the activity section.
    expect(onSelect).toHaveBeenCalledWith('a', 'activity');
  });

  it('does nothing on Enter before the cursor has been placed', () => {
    const m = board();
    mountTiles(['a']);
    const onSelect = vi.fn();
    renderHook(() => useAttentionCursor(m, [card('a', true)], onSelect));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves the keystroke alone while a field has focus', () => {
    const m = board();
    const { getByTestId } = render(<input data-testid="field" />);
    renderHook(() => useAttentionCursor(m, [], vi.fn()));
    const field = getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: 'n' });
    expect(document.activeElement).toBe(field);
  });
});
