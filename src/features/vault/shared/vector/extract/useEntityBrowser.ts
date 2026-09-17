/**
 * Entity browsing state for the Extract tab: the server-filtered page, the
 * chip row, and the export of whatever is currently visible.
 *
 * The chip row is deliberately fed by the UNFILTERED read only. A filtered
 * read sees one type by construction, so letting it own the chips would
 * collapse the row to the chip you just pressed and strand you there.
 */
import { useCallback, useEffect, useState } from 'react';
import { kbListEntities, type KbEntity } from '@/api/vault/database/vectorKb';
import { createLogger } from '@/lib/log';
import { trackInteraction } from '@/lib/analytics';
import {
  distinctEntityTypes,
  toEntityCsv,
  toEntityJson,
  entityExportFilename,
  downloadTextFile,
} from './entityExport';

const logger = createLogger('vector-kb-entities');

/** One page of entities. Named so the table's ceiling is never implicit. */
export const ENTITY_PAGE_SIZE = 200;

export interface EntityBrowser {
  entities: KbEntity[];
  isLoading: boolean;
  types: string[];
  typeFilter: string | null;
  setTypeFilter: (type: string | null) => void;
  /** Re-read the current filter (used when an extraction run finishes). */
  reload: () => void;
  exportEntities: (format: 'csv' | 'json') => void;
}

export function useEntityBrowser(kbId: string, kbName: string): EntityBrowser {
  const [entities, setEntities] = useState<KbEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [types, setTypes] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const load = useCallback(async (entityType: string | null) => {
    setIsLoading(true);
    try {
      const rows = await kbListEntities(kbId, entityType ?? undefined, ENTITY_PAGE_SIZE);
      setEntities(rows);
      if (entityType === null) setTypes(distinctEntityTypes(rows));
    } catch (err) {
      logger.error('Failed to load entities', { error: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, [kbId]);

  useEffect(() => { void load(typeFilter); }, [load, typeFilter]);

  const reload = useCallback(() => { void load(typeFilter); }, [load, typeFilter]);

  const exportEntities = useCallback((format: 'csv' | 'json') => {
    const content = format === 'csv' ? toEntityCsv(entities) : toEntityJson(entities);
    downloadTextFile(
      content,
      entityExportFilename(kbName, typeFilter, format),
      format === 'csv' ? 'text/csv' : 'application/json',
    );
    // Shape only -- format and whether a filter was active, never a value.
    trackInteraction('vector_kb', 'entities_export', `format=${format};filtered=${typeFilter !== null}`);
  }, [entities, kbName, typeFilter]);

  return { entities, isLoading, types, typeFilter, setTypeFilter, reload, exportEntities };
}
