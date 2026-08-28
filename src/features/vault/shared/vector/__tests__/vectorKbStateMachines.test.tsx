import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import type {
  KnowledgeBase,
  KbDocument,
  KbSearchResponse,
  VectorSearchResult,
  KbExtractionSchema,
} from '@/api/vault/database/vectorKb';
import {
  kbSearch,
  kbListDocuments,
  kbInferSchema,
  kbRunExtraction,
  kbListEntities,
} from '@/api/vault/database/vectorKb';
import { SearchTab } from '../tabs/SearchTab';
import { ExtractTab } from '../tabs/ExtractTab';
import { DocumentsTab } from '../tabs/DocumentsTab';
import { StatusBadge } from '../tabs/StatusBadge';

/**
 * The three real state machines in this context — the search-sequence guard,
 * the extraction double-run latch, and the documents load-failure/not-found
 * split — plus StatusBadge's token mapping.
 *
 * All four were defects fixed by hand with nothing pinning them: the kind a
 * later refactor silently reintroduces, because each failure mode looks like
 * working software (stale results are still results, a second extraction run
 * still produces rows, an empty list still renders).
 */
vi.mock('@/api/vault/database/vectorKb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vault/database/vectorKb')>();
  return {
    ...actual,
    kbSearch: vi.fn(),
    kbListDocuments: vi.fn(),
    kbDeleteDocument: vi.fn(),
    kbPickFiles: vi.fn(),
    kbIngestFiles: vi.fn(),
    kbCorpusMap: vi.fn(),
    kbInferSchema: vi.fn(),
    kbRunExtraction: vi.fn(),
    kbListEntities: vi.fn(),
  };
});

const mockSearch = vi.mocked(kbSearch);
const mockListDocuments = vi.mocked(kbListDocuments);
const mockInferSchema = vi.mocked(kbInferSchema);
const mockRunExtraction = vi.mocked(kbRunExtraction);
const mockListEntities = vi.mocked(kbListEntities);

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

function hit(content: string): VectorSearchResult {
  return {
    chunkId: `chunk-${content}`,
    documentId: 'doc-1',
    documentTitle: `title-${content}`,
    content,
    score: 0.9,
    distance: 0.1,
    sourcePath: null,
    sourcePage: null,
    extractionConfidence: 1,
    metadata: null,
  };
}

const response = (content: string): KbSearchResponse => ({ results: [hit(content)], floorFiltered: 0 });

function doc(overrides: Partial<KbDocument> = {}): KbDocument {
  return {
    id: 'doc-1',
    kbId: KB.id,
    sourceType: 'pdf',
    sourcePath: null,
    title: 'Report',
    contentHash: 'abc',
    byteSize: 1024,
    chunkCount: 4,
    metadataJson: null,
    pageCount: null,
    emptyPages: 0,
    status: 'indexed',
    errorMessage: null,
    indexedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const SCHEMA: KbExtractionSchema = {
  entities: [{ entityType: 'footing', description: 'a footing', fields: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListEntities.mockResolvedValue([]);
  // SearchTab builds its source filter from the document list; every suite that
  // does not care about documents still needs the call to resolve.
  mockListDocuments.mockResolvedValue([]);
});

describe('SearchTab — search sequence guard', () => {
  it('a slower earlier query cannot overwrite the newer results', async () => {
    const resolvers: Array<(r: KbSearchResponse) => void> = [];
    mockSearch.mockImplementation(() => new Promise<KbSearchResponse>((res) => { resolvers.push(res); }));

    render(<SearchTab kb={KB} />);
    const input = screen.getByPlaceholderText(/Ask a question/i);

    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Newest lands first, then the stale one arrives late.
    await act(async () => { resolvers[1](response('SECOND')); });
    await act(async () => { resolvers[0](response('FIRST')); });

    expect(screen.getByText('SECOND')).toBeTruthy();
    expect(screen.queryByText('FIRST')).toBeNull();
  });

  it('changing the result count re-runs the last executed query, not the typed box', async () => {
    mockSearch.mockResolvedValue(response('ONLY'));

    render(<SearchTab kb={KB} />);
    const input = screen.getByPlaceholderText(/Ask a question/i);

    fireEvent.change(input, { target: { value: 'executed' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(mockSearch).toHaveBeenCalledTimes(1);

    // The user edits the box but does NOT search, then widens the result count.
    fireEvent.change(input, { target: { value: 'not searched yet' } });
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });
    });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2));
    expect(mockSearch.mock.calls[1][0]).toMatchObject({ query: 'executed', topK: 50 });
  });
});

describe('SearchTab — the count carries its predicate', () => {
  it('says "Top n" when the page is full and "n results" when it is not', async () => {
    // topK defaults to 10: a full page is a cut, a short page is everything.
    mockSearch.mockResolvedValue({
      results: Array.from({ length: 10 }, (_, i) => hit(`h${i}`)),
      floorFiltered: 0,
    });

    const view = render(<SearchTab kb={KB} />);
    const input = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(input, { target: { value: 'wide' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(await screen.findByText(/Top 10 for/)).toBeTruthy();
    view.unmount();

    mockSearch.mockResolvedValue({ results: [hit('a'), hit('b')], floorFiltered: 0 });
    render(<SearchTab kb={KB} />);
    const narrow = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(narrow, { target: { value: 'narrow' } });
    await act(async () => { fireEvent.keyDown(narrow, { key: 'Enter' }); });

    expect(await screen.findByText(/2 results for/)).toBeTruthy();
    expect(screen.queryByText(/Top 2 for/)).toBeNull();
  });
});

describe('SearchTab — source scoping', () => {
  it('offers only path-backed documents and passes the choice as filterSource', async () => {
    mockListDocuments.mockResolvedValue([
      doc({ id: 'd1', title: 'Q3 report', sourcePath: '/reports/q3.pdf' }),
      doc({ id: 'd2', title: 'Pasted note', sourcePath: null }),
    ]);
    mockSearch.mockResolvedValue(response('ONLY'));

    render(<SearchTab kb={KB} />);
    const input = screen.getByPlaceholderText(/Ask a question/i);

    // "All documents" + the one document that actually has a path.
    const sourceSelect = await screen.findByDisplayValue('All documents');
    expect(screen.getByText('Q3 report')).toBeTruthy();
    expect(screen.queryByText('Pasted note')).toBeNull();

    fireEvent.change(input, { target: { value: 'footings' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(mockSearch.mock.calls[0][0].filterSource).toBeUndefined();

    await act(async () => {
      fireEvent.change(sourceSelect, { target: { value: '/reports/q3.pdf' } });
    });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2));
    expect(mockSearch.mock.calls[1][0]).toMatchObject({
      query: 'footings',
      filterSource: '/reports/q3.pdf',
    });
  });
});

describe('ExtractTab — double-run latch', () => {
  it('two rapid clicks on Extract spawn exactly one run', async () => {
    mockInferSchema.mockResolvedValue(SCHEMA);
    mockRunExtraction.mockImplementation(() => new Promise<string>(() => { /* never settles */ }));

    render(<ExtractTab kb={KB} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Suggest a schema/i })); });

    const run = await screen.findByRole('button', { name: /Extract entities/i });
    await act(async () => {
      fireEvent.click(run);
      fireEvent.click(run);
    });

    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentsTab — load failure is not "no documents"', () => {
  it('a failed fetch shows the error, never the empty state', async () => {
    mockListDocuments.mockRejectedValue(new Error('kb offline'));

    render(<DocumentsTab kb={KB} onRefresh={() => {}} />);

    expect(await screen.findByText('kb offline')).toBeTruthy();
    expect(screen.queryByText('No documents yet')).toBeNull();
  });

  it('an empty corpus shows the empty state, never an error', async () => {
    mockListDocuments.mockResolvedValue([]);

    render(<DocumentsTab kb={KB} onRefresh={() => {}} />);

    expect(await screen.findByText('No documents yet')).toBeTruthy();
    expect(screen.queryByText('kb offline')).toBeNull();
  });
});

describe('StatusBadge — backend tokens never reach the user raw', () => {
  it("resolves the ingest pipeline's in-flight tokens through the catalog", () => {
    const { container } = render(<StatusBadge status="indexing" error={null} />);
    expect(container.textContent).toBe('indexing');
  });

  it("treats the backend's 'failed' as an error, not an unknown token", () => {
    const { container } = render(<StatusBadge status="failed" error="boom" />);
    // `error` is the catalog label for the error arm; the raw token must not leak.
    expect(container.textContent).toBe('error');
  });
});

/**
 * `documentCount` is used by DocToolbar, which is exercised through DocumentsTab
 * above; kept here so the fixture stays honest if the prop is ever renamed.
 */
describe('fixtures', () => {
  it('doc() builds a KbDocument the component accepts', () => {
    expect(doc({ status: 'indexing' }).status).toBe('indexing');
  });
});
