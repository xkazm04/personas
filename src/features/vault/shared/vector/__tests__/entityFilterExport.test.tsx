import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { KnowledgeBase, KbEntity } from '@/api/vault/database/vectorKb';
import { kbListEntities } from '@/api/vault/database/vectorKb';
import { ExtractTab } from '../tabs/ExtractTab';
import { toEntityCsv, csvCell, distinctEntityTypes, entityExportFilename } from '../extract/entityExport';

/**
 * Extraction's product claim is typed rows an operator can count and take
 * elsewhere. The table was a flat dump: `kb_list_entities` has always taken an
 * entityType and nothing passed it, and attributes lived in an un-pasteable
 * wrap row. These cases pin the two halves of the handoff -- a chip narrows
 * the read, and the export carries exactly what the chip left visible.
 */
vi.mock('@/api/vault/database/vectorKb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vault/database/vectorKb')>();
  return { ...actual, kbListEntities: vi.fn(), kbInferSchema: vi.fn(), kbRunExtraction: vi.fn() };
});
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

const mockListEntities = vi.mocked(kbListEntities);

const KB: KnowledgeBase = {
  id: 'kb-1',
  credentialId: 'cred-1',
  name: 'Structural Set',
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

function entity(id: string, entityType: string, attributes: Record<string, unknown> = {}): KbEntity {
  return {
    id,
    runId: 'run-1',
    kbId: 'kb-1',
    documentId: 'doc-1',
    documentTitle: 'Sheet S-1',
    sourcePage: 4,
    entityType,
    entityKey: `${entityType}-${id}`,
    attributes: attributes as KbEntity['attributes'],
    extractionConfidence: 0.9,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

const MIXED = [
  entity('a', 'footing', { size: '4x4' }),
  entity('b', 'column', { height: 12 }),
  entity('c', 'footing', { size: '6x6' }),
];

describe('extracted entities — type filter and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEntities.mockResolvedValue(MIXED);
  });

  it('narrows the read to the picked type instead of filtering in the browser', async () => {
    render(<ExtractTab kb={KB} />);
    await waitFor(() => expect(screen.getByTestId('entity-type-chip-footing')).toBeTruthy());

    mockListEntities.mockResolvedValue([MIXED[0]!, MIXED[2]!]);
    fireEvent.click(screen.getByTestId('entity-type-chip-footing'));

    await waitFor(() =>
      expect(mockListEntities).toHaveBeenCalledWith('kb-1', 'footing', expect.any(Number)),
    );
  });

  it('keeps every type in the chip row after a filtered read', async () => {
    render(<ExtractTab kb={KB} />);
    await waitFor(() => expect(screen.getByTestId('entity-type-chip-column')).toBeTruthy());

    mockListEntities.mockResolvedValue([MIXED[0]!, MIXED[2]!]);
    fireEvent.click(screen.getByTestId('entity-type-chip-footing'));

    // The filtered read sees one type by construction; letting it own the
    // chips would strand the user on the chip they just pressed.
    await waitFor(() => expect(mockListEntities).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('entity-type-chip-column')).toBeTruthy();
  });

  it('exports only the rows the filter left visible', () => {
    const csv = toEntityCsv([MIXED[0]!, MIXED[2]!]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines.slice(1).every((l) => l.startsWith('footing,'))).toBe(true);
    expect(csv).not.toContain('column');
  });

  it('gives every attribute key its own column so a sheet can count them', () => {
    const csv = toEntityCsv(MIXED);
    const header = csv.split('\r\n')[0]!;
    expect(header).toBe('entity_type,entity_key,document,page,confidence,height,size');
  });

  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('derives a stable, deduplicated chip set', () => {
    expect(distinctEntityTypes(MIXED)).toEqual(['column', 'footing']);
  });

  it('names the file after the knowledge base and the active filter', () => {
    expect(entityExportFilename('Structural Set', 'footing', 'csv')).toBe('structural-set-entities-footing.csv');
    expect(entityExportFilename('Structural Set', null, 'json')).toBe('structural-set-entities.json');
  });
});
