import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { RowView } from '../../model/types';

/** "Type your own": Enter decides, Escape cancels; the page keymap never sees these keys. */
export function Typer({ row, onTyped }: { row: RowView; onTyped: (row: RowView, text: string | null) => void }) {
  const { t, tx } = useTranslation();
  const [text, setText] = useState(row.state === 'decided' ? row.headline : '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const label = tx(t.athena.standup.cards.type_placeholder, { name: row.name });
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onTyped(row, text); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onTyped(row, null); }
  };
  return (
    <input
      ref={ref}
      className={`${INPUT_FIELD} sb-typer`}
      value={text}
      aria-label={label}
      placeholder={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
    />
  );
}
