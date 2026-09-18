/**
 * Three states, where there used to be one.
 *
 * `useDriveKnowledge`'s own header names `kb:ingest_progress` as the event
 * progress arrives on, and nothing in Drive subscribed to it. So after "Queued
 * 40 items" the drawer opened on a KB reading `0 documents` - identical to an
 * empty one - and ExtractTab read that zero as "empty KB". The drawer could
 * distinguish complete from not-complete and nothing else.
 *
 * The middle state is what these tests are for: in-flight must be visibly
 * different from both empty and done.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

import { EventName, type KbIngestProgressPayload } from '@/lib/eventRegistry';

/** Handlers registered per event name, so a test can fire one. Progress comes
 *  through the buffered singleton, completion through the typed hook - both are
 *  stubbed to the same registry so a test fires either the same way. */
const handlers = new Map<string, ((p: unknown) => void)[]>();
function record(name: string, handler: (p: unknown) => void) {
  const list = handlers.get(name) ?? [];
  if (!list.includes(handler)) list.push(handler);
  handlers.set(name, list);
}
vi.mock('@/hooks/useTauriEvent', () => ({
  useTypedTauriEvent: (name: string, handler: (p: unknown) => void) => record(name, handler),
}));
vi.mock('../kbIngestListener', async () => {
  const { EventName } = await vi.importActual<typeof import('@/lib/eventRegistry')>('@/lib/eventRegistry');
  return {
    useKbIngestProgress: (handler: (p: unknown) => void) => {
      record(EventName.KB_INGEST_PROGRESS, handler);
      return true;
    },
  };
});

const getKnowledgeBase = vi.fn();
vi.mock('@/api/vault/database/vectorKb', () => ({
  getKnowledgeBase: (...a: unknown[]) => getKnowledgeBase(...a),
}));

vi.mock('@/features/vault/shared/vector/tabs/SearchTab', () => ({ SearchTab: () => <div>ask</div> }));
vi.mock('@/features/vault/shared/vector/tabs/ExtractTab', () => ({ ExtractTab: () => <div>extract</div> }));
vi.mock('@/features/shared/components/modals', () => ({
  BaseModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DriveKnowledgeDrawer } from '../DriveKnowledgeDrawer';

const KB = { id: 'kb-1', name: 'Docs', documentCount: 0 } as never;

function fire(name: string, payload: KbIngestProgressPayload) {
  act(() => {
    for (const h of handlers.get(name) ?? []) h(payload);
  });
}

function progress(over: Partial<KbIngestProgressPayload> = {}): KbIngestProgressPayload {
  return {
    jobId: 'j1',
    kbId: 'kb-1',
    status: 'running',
    documentsTotal: 40,
    documentsDone: 12,
    chunksCreated: 120,
    currentFile: 'reports/q3.pdf',
    ...over,
  };
}

describe('DriveKnowledgeDrawer ingest states', () => {
  beforeEach(() => {
    handlers.clear();
    getKnowledgeBase.mockReset();
    getKnowledgeBase.mockResolvedValue(KB);
  });

  it('an unqueued drawer shows no strip at all', () => {
    render(<DriveKnowledgeDrawer kb={KB} onClose={() => {}} />);
    expect(screen.queryByTestId('drive-kb-ingest-strip')).toBeNull();
  });

  it('queued: the strip is up before any progress event lands', () => {
    render(<DriveKnowledgeDrawer kb={KB} queuedCount={40} onClose={() => {}} />);
    const strip = screen.getByTestId('drive-kb-ingest-strip');
    expect(strip.getAttribute('data-ingest')).toBe('running');
    // Asserted off the data attributes, not the copy: the `plugins` i18n
    // section is lazily loaded and resolves empty under the test harness, so a
    // text assertion here would be testing the loader, not the state machine.
    expect(strip.getAttribute('data-total')).toBe('40');
    expect(strip.getAttribute('data-done')).toBe('');
  });

  it('running: done/total and the current file, with a real progressbar', () => {
    render(<DriveKnowledgeDrawer kb={KB} queuedCount={40} onClose={() => {}} />);
    fire(EventName.KB_INGEST_PROGRESS, progress());

    const strip = screen.getByTestId('drive-kb-ingest-strip');
    expect(strip.getAttribute('data-ingest')).toBe('running');
    expect(strip.getAttribute('data-done')).toBe('12');
    expect(strip.getAttribute('data-total')).toBe('40');
    expect(strip.textContent).toContain('reports/q3.pdf');
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('12');
    expect(bar.getAttribute('aria-valuemax')).toBe('40');
  });

  it('complete: the state flips and the KB is re-read', async () => {
    getKnowledgeBase.mockResolvedValue({ ...KB, documentCount: 40 });
    render(<DriveKnowledgeDrawer kb={KB} queuedCount={40} onClose={() => {}} />);
    fire(EventName.KB_INGEST_PROGRESS, progress());
    fire(EventName.KB_INGEST_COMPLETE, progress({ documentsDone: 40, status: 'complete' }));

    await waitFor(() =>
      expect(screen.getByTestId('drive-kb-ingest-strip').getAttribute('data-ingest')).toBe('complete'),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('Extract waits while a job runs and the count is still zero', async () => {
    render(<DriveKnowledgeDrawer kb={KB} queuedCount={40} onClose={() => {}} />);
    fire(EventName.KB_INGEST_PROGRESS, progress());
    expect(screen.getByTestId('drive-kb-tab-extract')).toBeDisabled();

    // ...and is answerable again the moment documents exist, even mid-job.
    getKnowledgeBase.mockResolvedValue({ ...KB, documentCount: 12 });
    fire(EventName.KB_INGEST_COMPLETE, progress({ documentsDone: 40 }));
    await waitFor(() => expect(screen.getByTestId('drive-kb-tab-extract')).not.toBeDisabled());
  });

  it("another KB's ingest does not move this drawer's numbers", () => {
    render(<DriveKnowledgeDrawer kb={KB} onClose={() => {}} />);
    fire(EventName.KB_INGEST_PROGRESS, progress({ kbId: 'kb-OTHER' }));
    expect(screen.queryByTestId('drive-kb-ingest-strip')).toBeNull();
  });
});
