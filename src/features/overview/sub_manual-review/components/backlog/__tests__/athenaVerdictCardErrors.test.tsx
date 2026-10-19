/**
 * AthenaVerdictCard reads failures the IPC door actually produces.
 *
 * `invokeWithTimeout` rejects with a serialized AppError OBJECT, never an
 * `Error`. The card used to run `err instanceof Error ? err.message : String(err)`,
 * which turned that into "[object Object]": the detail line printed it, and the
 * expired-batch check (`/expired/` against the same string) could never match,
 * so a batch that outlived its consent window asked for a retry that cannot
 * succeed instead of telling the reviewer to re-run the triage.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadSectionsAsync } from '@/i18n/useTranslation';

const athenaTriageBatch = vi.fn();
const applyTriageVerdicts = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  athenaTriageBatch: (...a: unknown[]) => athenaTriageBatch(...a),
  applyTriageVerdicts: (...a: unknown[]) => applyTriageVerdicts(...a),
}));

import { AthenaVerdictCard } from '../AthenaVerdictCard';

const BATCH = {
  approvalId: 'appr-1',
  summary: 'One idea judged.',
  items: [{ ideaId: 'idea-1', title: 'Cache the roster', verdict: 'accept', reason: 'cheap win' }],
  skipped: [],
};

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

beforeEach(() => {
  athenaTriageBatch.mockReset();
  applyTriageVerdicts.mockReset();
});

async function renderCard() {
  render(
    <AthenaVerdictCard ideaIds={['idea-1']} rowsById={new Map()} onClose={vi.fn()} onApplied={vi.fn()} />,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AthenaVerdictCard — AppError rejections', () => {
  it('an expired approval (AppError object) asks for a re-run, not a retry', async () => {
    athenaTriageBatch.mockResolvedValue(BATCH);
    applyTriageVerdicts.mockRejectedValue({
      error:
        'Approval `appr-1` has expired (pending beyond the consent-freshness window). Dismiss it and re-issue the request.',
      kind: 'Validation',
    });
    await renderCard();
    await act(async () => {
      fireEvent.click(await screen.findByText(/Apply 1 accepts/));
    });
    expect(await screen.findByText(/expired before it was applied/i)).toBeTruthy();
    expect(screen.queryByText(/object Object/)).toBeNull();
  });

  it('a failed triage turn never prints "[object Object]"', async () => {
    athenaTriageBatch.mockRejectedValue({ error: 'headless leg timed out', kind: 'Timeout' });
    await renderCard();
    expect(await screen.findByText(/couldn't finish this batch/i)).toBeTruthy();
    expect(screen.queryByText(/object Object/)).toBeNull();
  });
});
