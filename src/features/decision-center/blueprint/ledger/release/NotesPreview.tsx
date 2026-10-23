import { useMemo } from 'react';
import type { Proposal } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { notesPreview, type ReleaseModel } from '../../model/ledgerRelease';

/**
 * The notes the release will publish (bp NotesPreview), in a disclosure: the open release's own notes once written,
 * else a preview generated from the package. The notes are the release run's artifact (Markdown, as the run writes
 * it), shown verbatim as data.
 */
export function NotesPreview({ m, version, conflicts }: { m: ReleaseModel; version: string; conflicts: readonly Proposal[] }) {
  const s = useSheet();
  const { B } = s.text;
  const own = m.rel?.notes, name = s.data.product.name;
  const text = useMemo(() => own ?? notesPreview(name, version, m.items, conflicts), [own, name, version, m.items, conflicts]);
  return (
    <details className="tr-rel-notes" open>
      <summary>{own ? B.lg_rel_notes : B.lg_rel_notes_preview}</summary>
      <pre data-testid="blueprint-ledger-notes">{text}</pre>
    </details>
  );
}
