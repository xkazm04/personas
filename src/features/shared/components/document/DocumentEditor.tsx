import { useEffect, useRef } from 'react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

interface DocumentEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Saves the whole section. Rejecting leaves the editor open with the draft. */
  onSave: () => Promise<void>;
  /** Steps out and KEEPS the draft. Never discards. */
  onStopWriting: () => void;
  /** Character offset to place the caret at on open, if any. */
  caretAt?: number | null;
  labels: {
    field: string;
    hint: string;
    save: string;
    stop: string;
  };
  testIdSuffix: string;
}

/**
 * @catalog DocumentEditor — DocumentSurface's inline write mode: one textarea holding the whole section, opened with the caret in the block that was clicked. Part of DocumentSurface, not a standalone primitive.
 *
 * Writing happens where the reading happened: one textarea holding the WHOLE
 * section, opened with the caret already in the block that was clicked.
 *
 * The section is the unit of saving, so it is also the unit of editing — a
 * per-block editor would have to reassemble the section on save, which is
 * exactly the step that loses a heading marker or a list indent. Here the text
 * the user sees is the text that is stored.
 *
 * Escape is wired by the caller to `onStopWriting`, which keeps the draft.
 * Nothing in this component discards anything.
 */
export function DocumentEditor({
  value,
  onChange,
  onSave,
  onStopWriting,
  caretAt,
  labels,
  testIdSuffix,
}: DocumentEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus once per opening. The caret goes where the click landed so that
  // "click the paragraph you meant" survives into write mode.
  const opened = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || opened.current) return;
    opened.current = true;
    el.focus();
    const at = Math.min(Math.max(caretAt ?? el.value.length, 0), el.value.length);
    el.setSelectionRange(at, at);
    // Bring the caret into view without yanking the page for a short section.
    el.scrollTop = 0;
  }, [caretAt]);

  return (
    <div className="space-y-2" data-testid={`document-editor-${testIdSuffix}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onStopWriting();
            return;
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void onSave();
          }
        }}
        rows={Math.min(28, Math.max(8, value.split('\n').length + 2))}
        aria-label={labels.field}
        className={`${INPUT_FIELD} typo-body resize-y leading-relaxed`}
        data-testid={`document-textarea-${testIdSuffix}`}
      />
      <p className="typo-caption text-foreground">{labels.hint}</p>
      <div className="flex items-center gap-2">
        <AsyncButton
          size="sm"
          variant="primary"
          onClick={onSave}
          data-testid={`document-save-${testIdSuffix}`}
        >
          {labels.save}
        </AsyncButton>
        <Button
          size="sm"
          variant="ghost"
          onClick={onStopWriting}
          data-testid={`document-stop-${testIdSuffix}`}
        >
          {labels.stop}
        </Button>
      </div>
    </div>
  );
}
