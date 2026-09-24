import { useCallback, useMemo, useState } from 'react';
import {
  removeRow,
  spliceRow,
  splitBlocks,
  splitRowAt,
  type DocumentBlock,
  type DocumentSection,
} from './documentModel';

interface UseDocumentSurfaceArgs {
  sections: readonly DocumentSection[];
  onSaveSection?: (sectionId: string, body: string) => Promise<void>;
}

/**
 * Which chapter is open, which row the reading mark sits on, which row (if
 * any) is being written in, and the per-chapter drafts.
 *
 * WRITING IS PER ROW, SAVING IS PER CHAPTER. A click on a row of the
 * operator's own chapter opens THAT row in place; every keystroke is a splice
 * on the chapter's draft over the span the row came from, so the chapter's
 * markdown outside the row never changes. The draft is the whole chapter, and
 * a save writes the whole chapter — the server's rule.
 *
 * THE MARK STARTS ON THE FIRST ROW, as it does on the contest winner. Only an
 * explicit click opens a row, and only an explicit click on a read-only row
 * explains itself.
 *
 * DRAFTS ARE KEPT, NEVER DISCARDED HERE. Esc steps out and leaves the draft;
 * navigating away and back finds it; only a save that resolved clears it.
 */
export function useDocumentSurface({ sections, onSaveSection }: UseDocumentSurfaceArgs) {
  const [openId, setOpenId] = useState<string>(() => sections[0]?.id ?? '');
  const [markIndex, setMarkIndex] = useState(0);
  const [clicked, setClicked] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [caret, setCaret] = useState<number | 'end'>('end');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const open = useMemo(() => sections.find((s) => s.id === openId) ?? sections[0], [sections, openId]);
  const body = open ? (drafts[open.id] ?? open.body) : '';
  const blocks = useMemo(() => (open ? splitBlocks(open.id, body) : []), [open, body]);
  const hasDraft = useCallback((id: string) => drafts[id] !== undefined, [drafts]);
  const selectedBlockId = blocks[Math.min(markIndex, blocks.length - 1)]?.id ?? null;

  const write = useCallback(
    (next: string) => {
      if (!open) return;
      setDrafts((d) => ({ ...d, [open.id]: next }));
    },
    [open],
  );

  const openSection = useCallback((id: string) => {
    setOpenId(id);
    setMarkIndex(0);
    setClicked(false);
    setEditingIndex(null);
  }, []);

  const selectBlock = useCallback((block: DocumentBlock, canWrite: boolean) => {
    setMarkIndex(block.index);
    setClicked(true);
    if (!canWrite) return;
    setCaret('end');
    setEditingIndex(block.index);
  }, []);

  const editRow = useCallback((block: DocumentBlock, next: string) => write(spliceRow(body, block, next)), [body, write]);

  const splitRow = useCallback(
    (block: DocumentBlock, at: number) => {
      write(splitRowAt(body, block, at).body);
      setCaret(0);
      setEditingIndex(block.index + 1);
      setMarkIndex(block.index + 1);
    },
    [body, write],
  );

  const deleteRow = useCallback(
    (block: DocumentBlock) => {
      write(removeRow(body, block));
      const prev = Math.max(0, block.index - 1);
      setCaret('end');
      setEditingIndex(prev);
      setMarkIndex(prev);
    },
    [body, write],
  );

  const moveRow = useCallback(
    (from: DocumentBlock, delta: -1 | 1) => {
      const to = from.index + delta;
      if (to < 0 || to >= blocks.length) return;
      setCaret(delta < 0 ? 'end' : 0);
      setEditingIndex(to);
      setMarkIndex(to);
    },
    [blocks.length],
  );

  const save = useCallback(async () => {
    if (!open || !onSaveSection) return;
    await onSaveSection(open.id, drafts[open.id] ?? open.body);
    setDrafts((d) => {
      const next = { ...d };
      delete next[open.id];
      return next;
    });
    setEditingIndex(null);
  }, [open, onSaveSection, drafts]);

  const stopWriting = useCallback(() => setEditingIndex(null), []);

  return {
    open,
    blocks,
    hasDraft,
    selectedBlockId,
    clicked,
    editingIndex,
    writing: editingIndex !== null,
    caret,
    openSection,
    selectBlock,
    editRow,
    splitRow,
    deleteRow,
    moveRow,
    save,
    stopWriting,
  };
}
