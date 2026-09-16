/**
 * CanvasField — one region of the twin's passport, editable where it is drawn.
 *
 * The Canvas variant's whole claim is that the artifact is the surface: a user
 * who never says a word must be able to finish the twin by clicking the card
 * itself. So every region is a real editor — click to open, blur or Enter to
 * commit through `session.edit`, Escape to abandon — and it wears its own
 * outcome, because a failed write that only ever appeared in a toast has
 * already gone by the time the user looks back at the card.
 *
 * `seed` is how a proposal's Edit lands here: the region opens pre-filled with
 * the proposed value, still unsaved, so "edit" means edit rather than accept.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

type CommitState = 'idle' | 'saving' | 'saved' | 'error';

/** A nonce, so the same proposed text can seed the field twice. */
export interface CanvasFieldSeed {
  value: string;
  nonce: number;
}

interface CanvasFieldProps {
  label: string;
  value: string;
  /** Shown in place of an empty value. Muted by `typo-caption`, never a paragraph. */
  emptyText: string;
  multiline?: boolean;
  /** `title` for the name, `body` for everything else. */
  scale?: 'title' | 'body';
  /** A proposal is aimed at this region right now. */
  highlighted?: boolean;
  seed?: CanvasFieldSeed;
  testId: string;
  onCommit: (value: string) => Promise<void>;
  /** The proposal card, rendered inside the region it would change. */
  children?: ReactNode;
}

export function CanvasField({
  label, value, emptyText, multiline, scale = 'body', highlighted, seed, testId, onCommit, children,
}: CanvasFieldProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup.fields;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<CommitState>('idle');
  const lastValue = useRef(value);
  const lastSeed = useRef(seed?.nonce ?? 0);

  // Adopt a value that changed underneath us (a proposal was accepted while
  // this region sat idle). Keyed on the incoming value, so it cannot fight a
  // user mid-keystroke.
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    if (!editing) { setDraft(value); setState('idle'); }
  }, [value, editing]);

  useEffect(() => {
    if (!seed || lastSeed.current === seed.nonce) return;
    lastSeed.current = seed.nonce;
    setDraft(seed.value);
    setState('idle');
    setEditing(true);
  }, [seed]);

  const commit = async () => {
    setEditing(false);
    if (draft === value) { setState('idle'); return; }
    setState('saving');
    try {
      await onCommit(draft);
      setState('saved');
    } catch (err) {
      setState('error');
      toastCatch('features/plugins/twin/setup/variants/CanvasField:commit')(err);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setDraft(value); setEditing(false); e.preventDefault(); return; }
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { void commit(); e.preventDefault(); }
  };

  const note = state === 'saving' ? ts.saving : state === 'saved' ? ts.saved : state === 'error' ? ts.saveFailed : null;
  const shared = { value: draft, onKeyDown, onBlur: () => void commit(), 'data-testid': testId, autoFocus: true,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setState('idle'); } };

  return (
    <div
      data-testid={`${testId}-region`}
      className={`group rounded-card border transition-colors ${
        highlighted
          ? 'border-primary/50 bg-primary/10 shadow-elevation-2'
          : 'border-transparent hover:border-primary/25 hover:bg-secondary/25'
      }`}
    >
      <div className="flex items-baseline gap-2 px-2.5 pt-1.5">
        <span className="typo-caption uppercase tracking-[0.18em]">{label}</span>
        {note && <span className={`typo-caption ${state === 'error' ? 'text-status-error' : ''}`}>{note}</span>}
      </div>

      {editing ? (
        <div className="px-2.5 pb-2 pt-1">
          {multiline
            ? <textarea {...shared} rows={4} className={`${INPUT_FIELD} resize-y leading-relaxed`} />
            : <input {...shared} type="text" className={INPUT_FIELD} />}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid={`${testId}-open`}
          className="w-full flex items-start gap-2 px-2.5 pb-2 pt-0.5 text-left"
        >
          <span className="min-w-0 flex-1">
            {value
              ? <span className={`${scale === 'title' ? 'typo-title-lg' : 'typo-body'} text-foreground whitespace-pre-wrap leading-relaxed`}>{value}</span>
              : <span className="typo-caption">{emptyText}</span>}
          </span>
          <Pencil className="w-3.5 h-3.5 mt-1 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
        </button>
      )}

      {children}
    </div>
  );
}

export default CanvasField;
