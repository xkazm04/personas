import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { KnowledgeBase, KbDocument } from '@/api/vault/database/vectorKb';
import { kbListDocuments, kbDeleteDocument, kbPickFiles, kbIngestFiles } from '@/api/vault/database/vectorKb';
import { en } from '@/i18n/en';
import { DocumentsTab } from '../tabs/DocumentsTab';

/**
 * Deleting a document and starting a file ingest are user actions whose
 * failure was only written to the log: the row stayed, or nothing started,
 * and the user was told nothing (on a lite build every ingest fails with
 * "Vector store not initialized"). Both now report through toastCatch.
 */
const toastSink = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (context: string) => (err: unknown) => toastSink(context, err),
}));
vi.mock('@/api/vault/database/vectorKb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vault/database/vectorKb')>()),
  kbListDocuments: vi.fn(),
  kbDeleteDocument: vi.fn(),
  kbPickFiles: vi.fn(),
  kbIngestFiles: vi.fn(),
}));

const KB = {
  id: 'kb-1',
  name: 'Test KB',
  documentCount: 1,
  chunkCount: 4,
  status: 'ready',
} as KnowledgeBase;

const DOC = {
  id: 'doc-1',
  kbId: 'kb-1',
  sourceType: 'pdf',
  sourcePath: null,
  title: 'Report',
  byteSize: 1024,
  chunkCount: 4,
  pageCount: null,
  emptyPages: 0,
  status: 'indexed',
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00Z',
} as KbDocument;

const APP_ERROR = { error: 'Vector store not initialized', kind: 'Internal' };

beforeEach(() => {
  toastSink.mockReset();
  vi.mocked(kbListDocuments).mockResolvedValue([DOC]);
});

describe('DocumentsTab action failures reach the user', () => {
  it('a failed delete', async () => {
    vi.mocked(kbDeleteDocument).mockRejectedValue(APP_ERROR);
    render(<DocumentsTab kb={KB} onRefresh={() => {}} />);
    const del = await screen.findByTitle(en.vault.shared.delete_document);
    await act(async () => { fireEvent.click(del); });
    expect(toastSink).toHaveBeenCalledWith(expect.any(String), APP_ERROR);
    expect(screen.getByText('Report')).toBeTruthy();
  });

  it('a file ingest that fails to start', async () => {
    vi.mocked(kbPickFiles).mockResolvedValue(['C:/docs/a.pdf']);
    vi.mocked(kbIngestFiles).mockRejectedValue(APP_ERROR);
    render(<DocumentsTab kb={KB} onRefresh={() => {}} />);
    await screen.findByText('Report');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.vault.shared.browse_files })); });
    expect(toastSink).toHaveBeenCalledWith(expect.any(String), APP_ERROR);
  });
});
