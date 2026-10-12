// Reports are a history view: an unread report opens the Decision Deck
// (reports chip, this one on top); a read one keeps ReportDetailModal.
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { reportRow } from '@/features/decision-center/__tests__/rosterFixtures';

import { openReportDoor } from '../reportDeckDoor';

afterEach(() => act(() => closeDecisionDeck()));

describe('openReportDoor', () => {
  it('an unread report opens the deck on the reports chip with it on top', () => {
    const showDetail = vi.fn();
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ x: 0, y: 40, width: 600, height: 48 }) as DOMRect;
    expect(openReportDoor(reportRow({ id: 'rep-3', is_read: false }), showDetail, el)).toBe('deck');
    expect(showDetail).not.toHaveBeenCalled();
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'reports' });
    expect(req?.focusId).toBe('report:rep-3');
    expect(req?.origin).toEqual({ x: 0, y: 40, width: 600, height: 48 });
  });

  it('a read report keeps its detail modal', () => {
    const showDetail = vi.fn();
    const report = reportRow({ is_read: true });
    expect(openReportDoor(report, showDetail)).toBe('detail');
    expect(showDetail).toHaveBeenCalledWith(report);
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });
});
