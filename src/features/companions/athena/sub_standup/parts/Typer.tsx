import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../model/types';
import { Key } from './prims';

/** "Type your own" as a palette prompt line: Enter decides, Escape cancels; the page keymap never sees these keys. */
export function Typer({ row, onTyped }: { row: RowView; onTyped: (text: string | null) => void }) {
  const { t, tx } = useTranslation();
  const [text, setText] = useState(row.state === 'decided' ? row.headline : '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onTyped(text); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onTyped(null); }
  };
  const label = tx(t.athena.standup.cards.type_placeholder, { name: row.name });
  return (
    <label className="sc-typer" onClick={(e) => e.stopPropagation()}>
      <span className="sc-typer__caret" aria-hidden="true">›</span>
      <input
        ref={ref}
        className="sc-typer__input"
        value={text}
        aria-label={label}
        placeholder={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <Key>↵</Key>
    </label>
  );
}
