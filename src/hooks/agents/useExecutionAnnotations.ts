import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addAnnotation,
  deleteAnnotation,
  listPersonaAnnotations,
} from '@/api/agents/annotations';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import { silentCatch } from '@/lib/silentCatch';

const DEFAULT_AUTHOR = 'user';

/**
 * Loads all annotations for a persona once and indexes them by execution_id
 * (latest annotation per execution wins — updated_at DESC from the backend).
 * Mutations call through to the Tauri commands and patch the local cache.
 *
 * Used by ActivityList to render chip strips and by ExecutionDetail to power
 * the side panel without spawning a per-row IPC call.
 */
export function useExecutionAnnotations(personaId: string | undefined | null) {
  const [annotations, setAnnotations] = useState<ExecutionAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const personaRef = useRef(personaId);
  personaRef.current = personaId;

  const refresh = useCallback(async () => {
    if (!personaId) {
      setAnnotations([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listPersonaAnnotations(personaId);
      if (personaRef.current === personaId) {
        setAnnotations(rows);
      }
    } catch (err) {
      silentCatch('useExecutionAnnotations.refresh')(err);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

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
