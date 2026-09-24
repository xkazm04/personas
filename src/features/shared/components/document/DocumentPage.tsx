import type { ReactNode } from 'react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { editablePart, type DocumentBlock, type DocumentSection } from './documentModel';
import { DocumentBlocks } from './DocumentBlocks';
import { DocumentRowEditor } from './DocumentRowEditor';
import type { DocumentSurfaceLabels } from './documentLabels';

interface DocumentPageProps {
  section: DocumentSection;
  labels: DocumentSurfaceLabels;
  canWrite: boolean;
  blocks: readonly DocumentBlock[];
  selectedBlockId: string | null;
  clicked: boolean;
  hasDraft: boolean;
  editingIndex: number | null;
  caret: number | 'end';
  onSelectBlock: (block: DocumentBlock) => void;
  onEditRow: (block: DocumentBlock, next: string) => void;
  onSplitRow: (block: DocumentBlock, at: number) => void;
  onRemoveRow: (block: DocumentBlock) => void;
  onMoveRow: (block: DocumentBlock, delta: -1 | 1) => void;
  onSave: () => Promise<void>;
  onStopWriting: () => void;
  /** Rendered under the prose — waiting changes, provenance, actions. */
  footer?: ReactNode;
}

/**
 * @catalog DocumentPage — what the open leaf holds: the author seal, the title, a one-line lede, the chapter as clickable rows with the clicked row open for writing in place, and the chapter's save line. Part of DocumentSurface, not a standalone primitive.
 *
 * The leaf ELEMENT itself (`.ds-page`, `role="tabpanel"`) is rendered by
 * `DocumentSurface`, beside the tablist that drives it; this renders its
 * contents. Every class here is from `documentSurface.css`, held to the
 * contest winner's measured contract.
 */
export function DocumentPage({
  section,
  labels,
  canWrite,
  blocks,
  selectedBlockId,
  clicked,
  hasDraft,
  editingIndex,
  caret,
  onSelectBlock,
  onEditRow,
  onSplitRow,
  onRemoveRow,
  onMoveRow,
  onSave,
  onStopWriting,
  footer,
}: DocumentPageProps) {
  const writing = canWrite && editingIndex !== null;
  const editor = labels.editor(section.heading);

  return (
    <>
      <p className="ds-seal" data-role="doc-seal">
        <span className="ds-seal-dot" aria-hidden />
        {labels.mark(section.author)}
        <span className="ds-seal-quiet">{labels.sealQuiet(section.author, canWrite)}</span>
      </p>
      <h3 className="ds-title" data-role="doc-title">
        {section.heading}
      </h3>
      <p className="ds-lede" data-role="doc-lede">
        {labels.lede(section.author)}
      </p>

      <div className="ds-prose" data-role="doc-prose">
        {blocks.length > 0 ? (
          <DocumentBlocks
            blocks={blocks}
            selectedId={selectedBlockId}
            onSelect={onSelectBlock}
            editable={canWrite}
            blockActionLabel={labels.writeHere}
            editingIndex={canWrite ? editingIndex : null}
            renderEditor={(block) => (
              <DocumentRowEditor
                block={block}
                value={editablePart(block)}
                caret={caret}
                label={editor.field}
                onChange={(next) => onEditRow(block, next)}
                onSplit={(at) => onSplitRow(block, at)}
                onRemove={() => onRemoveRow(block)}
                onMove={(delta) => onMoveRow(block, delta)}
                onStopWriting={onStopWriting}
                onSave={() => void onSave()}
              />
            )}
          />
        ) : (
          <p className="typo-caption text-foreground">{labels.empty}</p>
        )}
      </div>

      {!canWrite && clicked && (
        <p className="typo-caption text-foreground mt-4" data-testid="document-readonly-note">
          {labels.readOnlyNote}
        </p>
      )}
      {canWrite && (writing || hasDraft) && (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-primary/10 pt-3">
          <p className="typo-caption text-foreground" data-testid="document-draft-note">
            {writing ? editor.hint : labels.draftKept}
          </p>
          <AsyncButton size="sm" variant="primary" onClick={onSave} data-testid={`document-save-${section.id}`}>
            {editor.save}
          </AsyncButton>
        </div>
      )}

      {footer && <div className="mt-7 space-y-2.5 border-t border-primary/10 pt-5">{footer}</div>}
    </>
  );
}
