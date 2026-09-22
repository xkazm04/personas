import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DocumentBlock } from './documentModel';

interface DocumentBlocksProps {
  blocks: readonly DocumentBlock[];
  /** The block the reading mark sits on, or null. */
  selectedId: string | null;
  /** A click selects a block. On an editable section it also opens the caret. */
  onSelect: (block: DocumentBlock) => void;
  /** True when a click will open the caret rather than only move the mark. */
  editable: boolean;
  /** Accessible verb for a block, e.g. "Write in this paragraph". */
  blockActionLabel: string;
}

/**
 * @catalog DocumentBlocks — a section's prose as individually clickable paragraphs, where one click selects and (where writable) opens the caret. Part of DocumentSurface, not a standalone primitive.
 *
 * A section's prose, as individually pointable blocks.
 *
 * ONE CLICK SELECTS AND OPENS. The interaction this carries is the one the
 * owner picked out of the contest field: a click on a paragraph both moves the
 * reading mark to it and — where the section is the operator's own — puts the
 * caret in it, rather than moving a mark and making the user find a second
 * gesture to start writing. Density follows attention: the selected block is
 * lifted, every other block stays exactly as calm as it was.
 *
 * On a section the operator may not write in, the click still selects, and the
 * surface says why typing is not on offer instead of silently doing nothing.
 */
export function DocumentBlocks({
  blocks,
  selectedId,
  onSelect,
  editable,
  blockActionLabel,
}: DocumentBlocksProps) {
  return (
    <div className="space-y-1" data-testid="document-blocks">
      {blocks.map((block) => {
        const selected = block.id === selectedId;
        return (
          <div
            key={block.id}
            role="button"
            tabIndex={0}
            aria-label={editable ? blockActionLabel : undefined}
            onClick={() => onSelect(block)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onSelect(block);
            }}
            className={`focus-ring relative rounded-input border-l-2 py-0.5 pl-3 transition-colors ${
              selected ? 'border-l-primary bg-secondary/30' : 'border-l-transparent hover:bg-secondary/20'
            } ${editable ? 'cursor-text' : 'cursor-default'}`}
            data-testid={`document-block-${block.id}`}
            data-selected={selected ? 'true' : undefined}
          >
            <MarkdownRenderer content={block.text} variant="document" />
          </div>
        );
      })}
    </div>
  );
}
