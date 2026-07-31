import { useCallback, useEffect, useRef, useState } from "react";

import { driveGetRoot, type DriveEntry } from "@/api/drive";

/**
 * Minimal shape the ingest path needs. `DriveEntry` satisfies it structurally,
 * but the open folder — which has no entry row of its own — does not, so the
 * caller can synthesize one from `currentPath`.
 */
export interface KnowledgeTarget {
  path: string;
  kind: DriveEntry["kind"];
}
import {
  createKnowledgeBase,
  kbIngestDirectory,
  kbIngestFiles,
  listKnowledgeBases,
  type KnowledgeBase,
} from "@/api/vault/database/vectorKb";
import { silentCatch } from "@/lib/silentCatch";
import { isCommandNotFound } from "@/lib/utils/tauri/safeInvoke";

/**
 * Bridges Drive's sandbox-relative world to the vector knowledge base, which
 * speaks absolute filesystem paths.
 *
 * Availability is *feature-detected* rather than read from a flag: the whole
 * `vector_kb` command module is `#[cfg(feature = "ml")]`, so on the default
 * `desktop` build `list_knowledge_bases` does not exist and the invoke
 * rejects. A rejection here means "this build has no KB lane" — every Drive
 * entry point stays hidden. See `./DESIGN.md`.
 */
export function useDriveKnowledge() {
  // null = still probing; false = build has no ML/KB lane.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [busy, setBusy] = useState(false);
  // The managed root never changes for the life of the process, so resolve it
  // at most once and reuse it for every path join.
  const rootRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setKnowledgeBases(await listKnowledgeBases());
      setAvailable(true);
    } catch (err) {
      // Only a genuine "command not registered" rejection means "this build
      // has no KB lane" and is not worth reporting. Any other failure (a
      // real backend error on an ML build) must not be swallowed silently —
      // it still hides the feature (we can't confirm availability), but a
      // breadcrumb is recorded so it's diagnosable instead of vanishing.
      if (!isCommandNotFound(err)) {
        silentCatch("drive:knowledge:refresh")(err);
      }
      setAvailable(false);
      setKnowledgeBases([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resolveRoot = useCallback(async () => {
    if (rootRef.current === null) rootRef.current = await driveGetRoot();
    return rootRef.current;
  }, []);

  /** Absolute path for a drive-relative entry. */
  const absolutePathFor = useCallback(
    async (relPath: string) => {
      const root = await resolveRoot();
      const trimmedRoot = root.replace(/[\\/]+$/, "");
      const rel = relPath.replace(/^[\\/]+/, "");
      // Forward slashes are safe on Windows — the backend canonicalizes.
      return rel ? `${trimmedRoot}/${rel}` : trimmedRoot;
    },
    [resolveRoot],
  );

  const create = useCallback(
    async (name: string) => {
      const kb = await createKnowledgeBase(name);
      await refresh();
      return kb;
    },
    [refresh],
  );

  /**
   * Ingest a selection into `kbId`. Files go through `kb_ingest_files` as one
   * batch; folders each get their own recursive `kb_ingest_directory` call
   * (the command takes a single directory). Both are backgrounded jobs on the
   * Rust side — progress arrives on the shared `kb:ingest_progress` event that
   * the KB surfaces already subscribe to.
   *
   * Returns the number of top-level entries handed off, so the caller can
   * report "queued N items" without claiming they are indexed yet.
   */
  const ingest = useCallback(
    async (entries: KnowledgeTarget[], kbId: string) => {
      if (entries.length === 0) return 0;
      setBusy(true);
      try {
        const files = entries.filter((e) => e.kind === "file");
        const folders = entries.filter((e) => e.kind === "folder");

        if (files.length > 0) {
          const paths = await Promise.all(
            files.map((e) => absolutePathFor(e.path)),
          );
          await kbIngestFiles(kbId, paths);
        }
        for (const folder of folders) {
          await kbIngestDirectory(kbId, await absolutePathFor(folder.path), []);
        }
        // Document counts move as the jobs land; re-read so a picker opened
        // straight after shows something closer to the truth.
        refresh().catch(silentCatch("drive:knowledge:refresh"));
        return entries.length;
      } finally {
        setBusy(false);
      }
    },
    [absolutePathFor, refresh],
  );

  return {
    available,
    knowledgeBases,
    busy,
    refresh,
    create,
    ingest,
  };
}

export type UseDriveKnowledgeResult = ReturnType<typeof useDriveKnowledge>;
