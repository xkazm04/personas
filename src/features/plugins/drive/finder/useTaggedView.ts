import { useCallback, useEffect, useRef, useState } from "react";

import { driveTagged, type DriveEntry, type DriveTag } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { createLatestWins } from "@/stores/util/latestWins";

import type { DriveApi, DriveMetaApi } from "./types";

/**
 * Sidebar tag click → a Drive-wide list of everything carrying that tag.
 * Re-fetched whenever the tag index changes (a toggle from the context menu
 * or a drop on the tag row must be visible immediately) and dismissed by any
 * navigation, exactly like the recursive search results.
 *
 * A failed fetch is state, not a toast: the user pressed nothing when it ran,
 * so the surface that was loading renders the failure with a Retry
 * (docs/concepts/golden-paths/error-surfacing-policy.md).
 */
export function useTaggedView(drive: DriveApi, meta: DriveMetaApi) {
  const [tag, setTag] = useState<DriveTag | null>(null);
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  // The rejection VALUE, resolved into copy where it renders (FinderDerivedList).
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(createLatestWins());
  const tagId = tag?.id ?? null;

  const clear = useCallback(() => {
    latest.current.next();
    setTag(null);
    setEntries(null);
    setError(null);
  }, []);

  const pick = useCallback(
    (target: DriveTag) => {
      setTag(target);
      setEntries(null);
      setError(null);
      drive.clearSelection();
    },
    [drive],
  );

  /** Re-run the fetch after a failure — the Retry on the inline error state. */
  const retry = useCallback(() => {
    setEntries(null);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // One fetch per (tag, index version, retry). The vocab entry may have been
  // renamed or deleted meanwhile, so the tag is re-resolved from the index.
  useEffect(() => {
    if (!tagId) return;
    const vocab = meta.meta?.vocab;
    const fresh = vocab?.find((x) => x.id === tagId);
    if (vocab && !fresh) {
      clear();
      return;
    }
    if (fresh) setTag((prev) => (prev && prev.id === fresh.id && prev !== fresh ? fresh : prev));
    const mine = latest.current.next();
    driveTagged(tagId)
      .then((list) => {
        if (latest.current.isCurrent(mine)) setEntries(list);
      })
      .catch((err: unknown) => {
        if (!latest.current.isCurrent(mine)) return;
        silentCatch("finder:tagged")(err);
        setError(err);
      });
  }, [meta.meta, tagId, clear, attempt]);

  // Any navigation leaves the tagged view.
  const pathRef = useRef(drive.currentPath);
  useEffect(() => {
    if (pathRef.current !== drive.currentPath) {
      pathRef.current = drive.currentPath;
      clear();
    }
  }, [drive.currentPath, clear]);

  return { tag, entries, error, pick, clear, retry };
}

export type TaggedViewApi = ReturnType<typeof useTaggedView>;
