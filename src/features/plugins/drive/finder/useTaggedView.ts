import { useCallback, useEffect, useRef, useState } from "react";

import { driveTagged, type DriveEntry, type DriveTag } from "@/api/drive";
import { toastCatch } from "@/lib/silentCatch";

import type { DriveApi, DriveMetaApi } from "./types";

/**
 * Sidebar tag click → a Drive-wide list of everything carrying that tag.
 * Re-fetched whenever the tag index changes (a toggle from the context menu
 * or a drop on the tag row must be visible immediately) and dismissed by any
 * navigation, exactly like the recursive search results.
 */
export function useTaggedView(drive: DriveApi, meta: DriveMetaApi) {
  const [tag, setTag] = useState<DriveTag | null>(null);
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  const seq = useRef(0);
  const tagId = tag?.id ?? null;

  const clear = useCallback(() => {
    seq.current++;
    setTag(null);
    setEntries(null);
  }, []);

  const pick = useCallback(
    (target: DriveTag) => {
      setTag(target);
      setEntries(null);
      drive.clearSelection();
    },
    [drive],
  );

  // One fetch per (tag, index version). The vocab entry may have been renamed
  // or deleted meanwhile, so the tag is re-resolved from the index each time.
  useEffect(() => {
    if (!tagId) return;
    const vocab = meta.meta?.vocab;
    const fresh = vocab?.find((x) => x.id === tagId);
    if (vocab && !fresh) {
      clear();
      return;
    }
    if (fresh) setTag((prev) => (prev && prev.id === fresh.id && prev !== fresh ? fresh : prev));
    const mine = ++seq.current;
    driveTagged(tagId)
      .then((list) => {
        if (mine === seq.current) setEntries(list);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        toastCatch("finder:tagged")(err);
        setEntries([]);
      });
  }, [meta.meta, tagId, clear]);

  // Any navigation leaves the tagged view.
  const pathRef = useRef(drive.currentPath);
  useEffect(() => {
    if (pathRef.current !== drive.currentPath) {
      pathRef.current = drive.currentPath;
      clear();
    }
  }, [drive.currentPath, clear]);

  return { tag, entries, pick, clear };
}

export type TaggedViewApi = ReturnType<typeof useTaggedView>;
