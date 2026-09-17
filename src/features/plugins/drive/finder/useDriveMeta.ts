import { useCallback, useEffect, useRef, useState } from "react";

import {
  DRIVE_TAG_COLORS,
  driveLabelId,
  driveMetaGet,
  driveTagDelete,
  driveTagsSet,
  driveTagUpsert,
  type DriveMeta,
  type DriveTag,
} from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";
import type { DriveMetaApi } from "./types";

/**
 * Local stand-in for the tag index while the Rust side is unavailable (the
 * command is being built in parallel and currently rejects every call). The
 * seven builtin colour labels still render, so the swatch row is never empty;
 * every write becomes a no-op instead of a toast storm.
 */
export function fallbackMeta(): DriveMeta {
  return {
    version: 1,
    vocab: DRIVE_TAG_COLORS.map((color) => ({
      id: driveLabelId(color),
      name: color,
      color,
      builtin: true,
    })),
    labels: {},
    warning: null,
  };
}

function withLabels(meta: DriveMeta, relPath: string, tagIds: string[]): DriveMeta {
  const labels = { ...meta.labels };
  if (tagIds.length === 0) delete labels[relPath];
  else labels[relPath] = tagIds;
  return { ...meta, labels };
}

export function useDriveMeta(): DriveMetaApi {
  const { t, tx } = useTranslation();
  const [meta, setMeta] = useState<DriveMeta | null>(null);
  const [loading, setLoading] = useState(true);
  // Mirror of `meta` for rollback snapshots inside async callbacks.
  const metaRef = useRef<DriveMeta | null>(null);
  const unavailableRef = useRef(false);
  const warnedRef = useRef<string | null>(null);

  const commit = useCallback((next: DriveMeta) => {
    metaRef.current = next;
    setMeta(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await driveMetaGet();
      unavailableRef.current = false;
      commit(next);
    } catch (err) {
      silentCatch("drive:meta-load")(err);
      unavailableRef.current = true;
      commit(fallbackMeta());
    } finally {
      setLoading(false);
    }
  }, [commit]);

  useEffect(() => {
    refresh().catch(silentCatch("drive:meta-load"));
  }, [refresh]);

  // Surface an index-moved-aside warning exactly once per distinct message.
  useEffect(() => {
    const warning = meta?.warning;
    if (!warning || warnedRef.current === warning) return;
    warnedRef.current = warning;
    useToastStore
      .getState()
      .addToast(tx(t.plugins.drive.finder.meta_warning, { warning }), "warning");
  }, [meta?.warning, t, tx]);

  const tagsFor = useCallback(
    (relPath: string): DriveTag[] => {
      if (!meta) return [];
      const ids = meta.labels[relPath];
      if (!ids || ids.length === 0) return [];
      return meta.vocab.filter((tag) => ids.includes(tag.id));
    },
    [meta],
  );

  /**
   * Optimistic write: apply `next` locally, then invoke. A rejection rolls
   * back to the snapshot and toasts; while the backend is unavailable the
   * local state simply stands.
   */
  const write = useCallback(
    async (next: DriveMeta, invoke: () => Promise<DriveMeta>) => {
      const snapshot = metaRef.current;
      commit(next);
      if (unavailableRef.current) return;
      try {
        commit(await invoke());
      } catch (err) {
        if (snapshot) commit(snapshot);
        toastCatch("drive:tags")(err);
      }
    },
    [commit],
  );

  const setTags = useCallback(
    async (relPath: string, tagIds: string[]) => {
      const current = metaRef.current;
      if (!current) return;
      const known = new Set(current.vocab.map((tag) => tag.id));
      const ids = tagIds.filter((id) => known.has(id));
      await write(withLabels(current, relPath, ids), () => driveTagsSet(relPath, ids));
    },
    [write],
  );

  const toggleTag = useCallback(
    async (relPath: string, tagId: string) => {
      const current = metaRef.current;
      if (!current) return;
      const ids = current.labels[relPath] ?? [];
      const next = ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId];
      await setTags(relPath, next);
    },
    [setTags],
  );

  const upsertTag = useCallback(
    async (tag: DriveTag) => {
      const current = metaRef.current;
      if (!current) return;
      const exists = current.vocab.some((v) => v.id === tag.id);
      const vocab = exists
        ? current.vocab.map((v) => (v.id === tag.id ? tag : v))
        : [...current.vocab, tag];
      await write({ ...current, vocab }, () => driveTagUpsert(tag));
    },
    [write],
  );

  const deleteTag = useCallback(
    async (tagId: string) => {
      const current = metaRef.current;
      if (!current) return;
      const target = current.vocab.find((v) => v.id === tagId);
      if (!target || target.builtin) return;
      const labels: DriveMeta["labels"] = {};
      for (const [path, ids] of Object.entries(current.labels)) {
        const kept = (ids ?? []).filter((id) => id !== tagId);
        if (kept.length > 0) labels[path] = kept;
      }
      const vocab = current.vocab.filter((v) => v.id !== tagId);
      await write({ ...current, vocab, labels }, () => driveTagDelete(tagId));
    },
    [write],
  );

  return { meta, loading, tagsFor, setTags, toggleTag, upsertTag, deleteTag, refresh };
}

/** Id for a freshly created user tag. */
export const newTagId = () => `tag:${crypto.randomUUID()}`;
