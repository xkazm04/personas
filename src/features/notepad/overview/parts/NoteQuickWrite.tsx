import { useState, type KeyboardEvent } from 'react';
import { Lock, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import type { DevNote } from '@/lib/bindings/DevNote';

import type { NotePatch } from '../../notepadStore';
import { canQuickWrite } from '../../noteText';
import { CardRichText } from './CardRichText';

interface NoteQuickWriteProps {
  note: DevNote;
  onPatch: (patch: NotePatch) => void;
  onOpen: () => void;
  autoFocus?: boolean;
}

/**
 * The card's text region.
 *
 * A draft of at most 100 visible characters (`canQuickWrite`) IS its editor: a
 * formatted, editable surface where typed markdown becomes formatting as you
 * type (`CardRichText`). While the caret is inside, the card stays editable
 * even past the limit, so it is never pulled from under the hand.
 *
 * Anything longer, or no longer a draft, renders formatted and faded at the
 * bottom edge, and opens the full editor on click. That region is a
 * `div role="button"`: a button may only hold phrasing content, and rendered
 * markdown is paragraphs and lists.
 */
export function NoteQuickWrite({ note, onPatch, onOpen, autoFocus = false }: NoteQuickWriteProps) {
  const { t } = useTranslation();
  const [holding, setHolding] = useState(false);

  if (holding || canQuickWrite(note)) {
    return (
      <CardRichText
        value={note.bodyMd}
        onChange={(bodyMd) => onPatch({ bodyMd })}
        onFocusChange={setHolding}
        autoFocus={autoFocus}
        ariaLabel={`${t.notepad.editor_label}: ${note.title}`}
        placeholder={t.notepad.editor_placeholder}
        testId={`notepad-quickwrite-${note.id}`}
      />
    );
  }

  const locked = note.status !== 'draft';
  const HintIcon = locked ? Lock : Maximize2;
  const open = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onOpen();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={open}
      data-testid={`notepad-card-body-${note.id}`}
      className="group/ex flex-1 min-h-0 flex flex-col gap-2 -mx-1.5 px-1.5 rounded-input cursor-pointer focus-ring"
    >
      <div className="flex-1 min-h-0 max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
        <DeferredMarkdown content={note.bodyMd} variant="card" />
      </div>
      <span className="flex items-center gap-1.5 typo-caption text-foreground/60 group-hover/ex:text-foreground transition-colors">
        <HintIcon className="w-3.5 h-3.5" aria-hidden />
        {locked ? t.notepad.overview_locked : t.notepad.overview_open_to_continue}
      </span>
    </div>
  );
}
