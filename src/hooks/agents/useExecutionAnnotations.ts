import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addAnnotation,
  deleteAnnotation,
  listPersonaAnnotations,
} from '@/api/agents/annotations';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import { silentCatch } from '@/lib/silentCatch';

const DEFAULT_AUTHOR = 'user';
/** Cap when the caller does not scope to a loaded execution page. */
const DEFAULT_LIMIT = 200;

export interface UseExecutionAnnotationsOpts {
  /** Restrict to these execution IDs (the currently loaded page). Empty skips the fetch. */
  executionIds?: string[];
  /** Optional LIMIT; defaults to 200 when `executionIds` is omitted. */
  limit?: number;
}

/**
 * Loads annotations for a persona and indexes them by execution_id
 * (latest annotation per execution wins — updated_at DESC from the backend).
 * Scoped to the loaded execution page when `executionIds` is passed, otherwise
 * LIMITed so a persona with a long annotation history is not dumped whole.
 * Mutations call through to the Tauri commands and patch the local cache.
 *
 * Used by ActivityList to render chip strips and by ExecutionDetail to power
 * the side panel without spawning a per-row IPC call.
 */
export function useExecutionAnnotations(
  personaId: string | undefined | null,
  opts?: UseExecutionAnnotationsOpts,
) {
  const [annotations, setAnnotations] = useState<ExecutionAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const personaRef = useRef(personaId);
  personaRef.current = personaId;
  const executionIds = opts?.executionIds;
  const idsKey = executionIds ? executionIds.join('\0') : '';
  const idsRef = useRef(executionIds);
  idsRef.current = executionIds;
  const limit = opts?.limit ?? (executionIds ? undefined : DEFAULT_LIMIT);

  const refresh = useCallback(async () => {
    if (!personaId) {
      setAnnotations([]);
      return;
    }
    const ids = idsRef.current;
    if (ids && ids.length === 0) {
      setAnnotations([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listPersonaAnnotations(personaId, {
        limit,
        executionIds: ids && ids.length > 0 ? ids : undefined,
      });
      if (personaRef.current === personaId) {
        setAnnotations(rows);
      }
    } catch (err) {
      silentCatch('useExecutionAnnotations.refresh')(err);
    } finally {
      setLoading(false);
    }
  }, [personaId, idsKey, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byExecution = useMemo(() => {
    const map = new Map<string, ExecutionAnnotation>();
    for (const a of annotations) {
      const existing = map.get(a.execution_id);
      if (!existing || (a.updated_at ?? '') > (existing.updated_at ?? '')) {
        map.set(a.execution_id, a);
      }
    }
    return map;
  }, [annotations]);

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of annotations) {
      for (const t of a.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [annotations]);

  const upsert = useCallback(
    async (
      executionId: string,
      callerPersonaId: string,
      tags: string[],
      note: string | null,
      starred: boolean,
    ) => {
      const saved = await addAnnotation(
        executionId,
        callerPersonaId,
        tags,
        note,
        starred,
        DEFAULT_AUTHOR,
      );
      setAnnotations((prev) => {
        const rest = prev.filter(
          (a) => !(a.execution_id === saved.execution_id && a.author === saved.author),
        );
        return [saved, ...rest];
      });
      return saved;
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await deleteAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { annotations, byExecution, knownTags, loading, refresh, upsert, remove };
}
