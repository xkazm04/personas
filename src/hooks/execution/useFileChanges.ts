import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export type FileChangeType = 'read' | 'write' | 'edit';

export interface TrackedFileChange {
  path: string;
  /** Set of change types (a file can be both read and edited). */
  types: Set<FileChangeType>;
}

interface FileChangePayload {
  execution_id: string;
  path: string;
  change_type: FileChangeType;
}

/**
 * Tracks file changes emitted during a persona execution.
 * Returns a Map of file path -> TrackedFileChange.
 */
export function useFileChanges(executionId: string | null): {
  changes: Map<string, TrackedFileChange>;
  editedCount: number;
  createdCount: number;
  readCount: number;
} {
  const [changes, setChanges] = useState<Map<string, TrackedFileChange>>(new Map());

  // Reset on execution change
  useEffect(() => {
    setChanges(new Map());
  }, [executionId]);

  // Listen for file change events
  useEffect(() => {
    if (!executionId) return;

    let cancelled = false;
    const unlistenPromise = listen<FileChangePayload>('execution-file-change', (event) => {
      if (cancelled || event.payload.execution_id !== executionId) return;
      setChanges((prev) => {
        const next = new Map(prev);
        const existing = next.get(event.payload.path);
        if (existing) {
          existing.types.add(event.payload.change_type);
        } else {
          next.set(event.payload.path, {
            path: event.payload.path,
            types: new Set([event.payload.change_type]),
          });
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [executionId]);

  // Compute counts with dedup priority: edit > write > read
  let editedCount = 0;
  let createdCount = 0;
  let readCount = 0;
  for (const change of changes.values()) {
    if (change.types.has('edit')) editedCount++;
    else if (change.types.has('write')) createdCount++;
    else readCount++;
  }

  return { changes, editedCount, createdCount, readCount };
}
