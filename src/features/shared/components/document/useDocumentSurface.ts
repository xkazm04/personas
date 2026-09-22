import { useCallback, useMemo, useState } from 'react';
import { splitBlocks, type DocumentBlock, type DocumentSection } from './documentModel';

interface UseDocumentSurfaceArgs {
  sections: readonly DocumentSection[];
  onSaveSection?: (sectionId: string, body: string) => Promise<void>;
}

/**
 * Which section is open, which block the reading mark sits on, whether we are
 * writing, and the per-section drafts.
 *
 * DRAFTS ARE KEPT, NEVER DISCARDED HERE. Stepping out of writing leaves the
 * draft in place under its section id, and navigating to another section and
 * back finds it again; the only thing that clears a draft is a save that
 * resolved. Nothing in this hook throws a draft away, which is what lets the
 * surface promise that its most-pressed key is not its most destructive one.
 */
export function useDocumentSurface({ sections, onSaveSection }: UseDocumentSurfaceArgs) {
  const [openId, setOpenId] = useState<string>(() => sections[0]?.id ?? '');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const open = useMemo(
    () => sections.find((s) => s.id === openId) ?? sections[0],
    [sections, openId],
  );
  const closed = useMemo(() => sections.filter((s) => s.id !== open?.id), [sections, open]);
  const body = open ? (drafts[open.id] ?? open.body) : '';
  const blocks = useMemo(
    () => (open ? splitBlocks(open.id, drafts[open.id] ?? open.body) : []),
    [open, drafts],
  );
  const hasDraft = !!open && drafts[open.id] !== undefined;

  const openSection = useCallback((id: string) => {
    setOpenId(id);
    setSelectedBlockId(null);
    setWriting(false);
    setCaretAt(null);
  }, []);

  // One click selects, and on a section the operator owns it also puts the
  // caret in the block that was clicked.
  const selectBlock = useCallback(
    (block: DocumentBlock, canWrite: boolean) => {
      setSelectedBlockId(block.id);
      if (!canWrite) return;
      setCaretAt(block.offset);
      setWriting(true);
    },
    [],
  );

  const setDraft = useCallback(
    (next: string) => {
      if (!open) return;
      setDrafts((d) => ({ ...d, [open.id]: next }));
    },
    [open],
  );

  const save = useCallback(async () => {
    if (!open || !onSaveSection) return;
    await onSaveSection(open.id, drafts[open.id] ?? open.body);
    setDrafts((d) => {
      const next = { ...d };
      delete next[open.id];
      return next;
    });
    setWriting(false);
    setCaretAt(null);
  }, [open, onSaveSection, drafts]);

  const stopWriting = useCallback(() => setWriting(false), []);

  return {
    open,
    closed,
    body,
    blocks,
    hasDraft,
    openId: open?.id ?? '',
    selectedBlockId,
    writing,
    caretAt,
    openSection,
    selectBlock,
    setDraft,
    save,
    stopWriting,
  };
}
