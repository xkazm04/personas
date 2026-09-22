import type { ReactNode } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DocumentBlock } from './documentModel';

interface DocumentBlocksProps {
  blocks: readonly DocumentBlock[];
  /** The row the reading mark sits on, or null. */
  selectedId: string | null;
  /** A click selects a row. On a writable section it also opens it for writing. */
  onSelect: (block: DocumentBlock) => void;
  /** True when a click will open the row rather than only move the mark. */
  editable: boolean;
  /** Accessible verb for a row, e.g. "Write in this line". */
  blockActionLabel: string;
  /** The row being written in, or null. */
  editingIndex: number | null;
  /** The in-place field for the row being written in. */
  renderEditor: (block: DocumentBlock) => ReactNode;
}

const headingText = (text: string) => text.replace(/^\s{0,3}#{1,6}\s+/, '');

/**
 * @catalog DocumentBlocks — a section's prose as individually clickable rows (each heading, paragraph and list item), where one click selects and (where writable) opens that row for writing in place. Part of DocumentSurface, not a standalone primitive.
 *
 * ONE ROW PER BULLET. A click on a line moves the reading mark to it and —
 * where the chapter is the operator's own — opens THAT row for writing, in
 * place: the row keeps its bullet and its reading type, and every other row
 * stays rendered. The row is the single bullet, not the list around it: a
 * manifest is mostly bullets, and a click that lit the whole list was the
 * regression the owner caught.
 *
 * Type comes from the page (`.ds-prose` in `documentSurface.css`), which beats
 * MarkdownRenderer's own per-element tokens on specificity, so reading prose is
 * the winner's 1rem / 1.75 rather than the renderer's body size.
 */
export function DocumentBlocks({
  blocks,
  selectedId,
  onSelect,
  editable,
  blockActionLabel,
  editingIndex,
  renderEditor,
}: DocumentBlocksProps) {
  return (
    <div data-testid="document-blocks">
      {blocks.map((block) => {
        const selected = block.id === selectedId;
        const editing = block.index === editingIndex;
        const ordered = block.kind === 'item' && /^\d/.test(block.marker);
        const kindClass =
          block.kind === 'item'
            ? `ds-item ${ordered ? 'is-ordered' : ''}`
            : block.kind === 'heading'
              ? block.depth <= 2
                ? 'ds-heading-2'
                : 'ds-heading-3'
              : '';
        return (
          <div
            key={block.id}
            role={editing ? undefined : 'button'}
            tabIndex={editing ? undefined : 0}
            aria-label={editable && !editing ? blockActionLabel : undefined}
            aria-pressed={editing ? undefined : selected}
            onClick={() => {
              if (!editing) onSelect(block);
            }}
            onKeyDown={(e) => {
              if (editing || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              onSelect(block);
            }}
            style={block.kind === 'item' && block.indent ? { marginLeft: `${1.2 + block.indent * 0.55}rem` } : undefined}
            className={`ds-block ${kindClass} ${selected ? 'is-mark' : ''} ${editable ? 'is-writable' : ''} ${
              editing ? 'is-editing' : ''
            }`}
            data-role="doc-block"
            data-kind={block.kind}
            data-selected={selected ? 'true' : undefined}
            data-testid={`document-block-${block.id}`}
          >
            {editing ? (
              renderEditor(block)
            ) : block.kind === 'heading' ? (
              headingText(block.text)
            ) : ordered ? (
              <span className="inline-flex gap-2">
                <span>{block.marker}</span>
                <MarkdownRenderer content={block.content} />
              </span>
            ) : (
              <MarkdownRenderer content={block.kind === 'item' ? block.content : block.text} />
            )}
          </div>
        );
      })}
    </div>
  );
}
