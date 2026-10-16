/**
 * THE QUEUE OPENS ON WHAT IS PENDING.
 *
 * The drawer used to draw every request ever filed, a week of landed rows
 * under the two the operator is waiting on. It now opens on the pending half
 * only, the settled history sits behind the head's History switch, and that
 * history is read twenty rows at a time rather than all at once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';

const history = vi.fn<(limit: number, offset: number) => Promise<CuratorRequest[]>>();
vi.mock('@/api/curator', () => ({
  curatorRequestsHistory: (limit: number, offset: number) => history(limit, offset),
}));

import { QueueDrawer } from '../../QueueDrawer';
import type { BlueprintStrings, BlueprintWords } from '../../words';
import { BlueprintWordsProvider } from '../../words';
import RequestHistory, { HISTORY_PAGE } from '../RequestHistory';
import { RequestLane } from '../RequestLane';

// The English catalog is the generated type's own source (`types.ts` is
// codegen'd from exactly this file), so the cast names no hidden mismatch.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};

function req(id: string, state: CuratorRequest['state']): CuratorRequest {
  return {
    id,
    skill: 'hygiene',
    argument: null,
    note: null,
    state,
    createdAt: '2026-10-01T09:00:00Z',
    startedAt: null,
    settledAt: state === 'queued' || state === 'dispatched' ? null : '2026-10-01T10:00:00Z',
    sessionId: null,
    outcome: null,
    resultRef: null,
    failureReason: null,
  };
}

const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => req(`h${from + i}`, 'landed'));
const noop = async () => {};

// jsdom has no IntersectionObserver; the "Load more" control is the same
// request, so the tests drive that and the observer stays inert.
class InertObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  history.mockReset();
  vi.stubGlobal('IntersectionObserver', InertObserver);
});

function renderDrawer() {
  return render(
    <BlueprintWordsProvider value={words}>
      <QueueDrawer open onClose={() => {}} history={<RequestHistory onCancel={noop} />}>
        <RequestLane
          requests={[req('p1', 'queued'), req('p2', 'dispatched'), req('s1', 'landed')]}
          onCancel={noop}
        />
      </QueueDrawer>
    </BlueprintWordsProvider>,
  );
}

const rowIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-role="cb-request"]')).map((el) => el.getAttribute('data-cb-id'));

describe('the queue drawer', () => {
  it('opens on the pending half and reads no history until asked', () => {
    const { container } = renderDrawer();
    expect(rowIds(container)).toEqual(['p1', 'p2']);
    expect(history).not.toHaveBeenCalled();
  });

  it('shows the history, a page of twenty at a time, from the head switch', async () => {
    history.mockResolvedValueOnce(page(0, HISTORY_PAGE)).mockResolvedValueOnce(page(HISTORY_PAGE, 3));
    const { container } = renderDrawer();

    fireEvent.click(container.querySelector('[data-role="cb-queue-view-history"]')!);
    await waitFor(() => expect(rowIds(container)).toHaveLength(HISTORY_PAGE));
    expect(history).toHaveBeenLastCalledWith(HISTORY_PAGE, 0);

    fireEvent.click(container.querySelector('[data-role="cb-history-more"]')!);
    await waitFor(() => expect(rowIds(container)).toHaveLength(HISTORY_PAGE + 3));
    expect(history).toHaveBeenLastCalledWith(HISTORY_PAGE, HISTORY_PAGE);

    // A short page is the end: no further control, and the end is said.
    expect(container.querySelector('[data-role="cb-history-more"]')).toBeNull();
    expect(screen.getByText(en.companions.blueprint.console.lane_history_end)).toBeTruthy();

    // And back to pending.
    fireEvent.click(container.querySelector('[data-role="cb-queue-view-pending"]')!);
    expect(rowIds(container)).toEqual(['p1', 'p2']);
  });
});
