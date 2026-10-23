import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import type { KnowledgeBase } from '@/api/vault/database/vectorKb';
import { kbSearch, kbListDocuments, kbInferSchema, kbListEntities } from '@/api/vault/database/vectorKb';
import { SearchTab } from '../tabs/SearchTab';
import { ExtractTab } from '../tabs/ExtractTab';
import { DocumentsTab } from '../tabs/DocumentsTab';

/**
 * `invokeWithTimeout` rejects with a serialized AppError OBJECT
 * (`{ error, kind }`), never an `Error`. Every catch in the vector KB read
 * `err instanceof Error ? err.message : String(err)`, so a real backend
 * failure reached KbErrorNotice as "[object Object]": the registry could not
 * match it and the technical-details disclosure showed nothing useful. The
 * sibling suite rejects with `new Error(..)`, which is why it never saw this.
 */
vi.mock('@/api/vault/database/vectorKb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vault/database/vectorKb')>()),
  kbSearch: vi.fn(),
  kbListDocuments: vi.fn(),
  kbInferSchema: vi.fn(),
  kbRunExtraction: vi.fn(),
  kbListEntities: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

const KB: KnowledgeBase = {
  id: 'kb-1',
  credentialId: 'cred-1',
  name: 'Test KB',
  description: null,
  embeddingModel: 'bge-small',
  embeddingDims: 384,
  chunkSize: 512,
  chunkOverlap: 64,
  documentCount: 3,
  chunkCount: 42,
  status: 'ready',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const APP_ERROR = { error: 'Embedding manager not initialized', kind: 'Internal' };

function expectBackendText(container: HTMLElement) {
  const text = container.textContent ?? '';
  expect(text).not.toContain('[object Object]');
  expect(text).toContain('Embedding manager not initialized');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kbListEntities).mockResolvedValue([]);
  vi.mocked(kbListDocuments).mockResolvedValue([]);
});

describe('vector KB surfaces keep the backend reason of an IPC rejection', () => {
  it('DocumentsTab', async () => {
    vi.mocked(kbListDocuments).mockRejectedValue(APP_ERROR);
    const { container } = render(<DocumentsTab kb={KB} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelector('details')).toBeTruthy());
    expectBackendText(container);
  });

  it('ExtractTab schema inference', async () => {
    vi.mocked(kbInferSchema).mockRejectedValue(APP_ERROR);
    const { container } = render(<ExtractTab kb={KB} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Suggest a schema/i })); });
    await waitFor(() => expect(container.querySelector('details')).toBeTruthy());
    expectBackendText(container);
  });

  it('SearchTab', async () => {
    vi.mocked(kbSearch).mockRejectedValue(APP_ERROR);
    const { container } = render(<SearchTab kb={KB} />);
    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'footings' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => expect(container.querySelector('details')).toBeTruthy());
    expectBackendText(container);
  });
});
