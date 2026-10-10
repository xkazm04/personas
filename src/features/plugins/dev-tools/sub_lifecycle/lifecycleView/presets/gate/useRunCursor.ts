/**
 * The control behind a drawn run series (a gate row's bars, the coverage
 * line): ONE listbox whose options are the runs, so the drawing is one tab
 * stop. Left / Right / Home / End move a cursor (newest is the right end, where
 * it starts); Enter or Space presses the cursor's run. The keys it uses are
 * marked handled, so the step screen's own Left / Right walk does not fire.
 *
 * The PEEK shows the run under the pointer, or the cursor's run while the
 * listbox has keyboard focus (`:focus-visible`; a DOM that cannot answer
 * counts as keyboard).
 */
import { useId, useState, type KeyboardEvent } from 'react';

function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export interface RunCursor {
  /** The keyboard cursor, an index into the series. */
  cursor: number;
  /** Whether the keyboard cursor is shown (the listbox has keyboard focus). */
  keyboard: boolean;
  /** The run the peek shows, or null. */
  peekIndex: number | null;
  /** The peek's anchor rectangle, or null when nothing is peeked. */
  anchor: DOMRect | null;
  listbox: {
    role: 'listbox';
    tabIndex: 0;
    'aria-orientation': 'horizontal';
    'aria-activedescendant': string | undefined;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onFocus: (e: { currentTarget: Element }) => void;
    onBlur: () => void;
  };
  option: (i: number) => {
    id: string;
    role: 'option';
    'aria-selected': boolean;
    onClick: () => void;
    onPointerEnter: (e: { currentTarget: Element }) => void;
    onPointerLeave: () => void;
  };
}

export function useRunCursor(count: number, onPress: (i: number) => void, selected: number | null = null): RunCursor {
  const base = useId();
  const last = Math.max(0, count - 1);
  const [cursorRaw, setCursor] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [hover, setHover] = useState<{ i: number; rect: DOMRect } | null>(null);
  const cursor = Math.min(Math.max(0, cursorRaw ?? selected ?? last), last);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (count === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setCursor(Math.max(0, cursor - 1)),
      ArrowRight: () => setCursor(Math.min(last, cursor + 1)),
      Home: () => setCursor(0),
      End: () => setCursor(last),
      Enter: () => onPress(cursor),
      ' ': () => onPress(cursor),
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  };

  const peekIndex = hover?.i ?? (keyboard && count > 0 ? cursor : null);
  const peekEl = peekIndex != null && hover == null && typeof document !== 'undefined' ? document.getElementById(`${base}-${peekIndex}`) : null;
  const anchor = hover?.rect ?? (peekEl ? peekEl.getBoundingClientRect() : null);

  return {
    cursor,
    keyboard,
    peekIndex,
    anchor,
    listbox: {
      role: 'listbox',
      tabIndex: 0,
      'aria-orientation': 'horizontal',
      'aria-activedescendant': count > 0 ? `${base}-${cursor}` : undefined,
      onKeyDown,
      onFocus: (e) => setKeyboard(keyboardFocus(e.currentTarget)),
      onBlur: () => setKeyboard(false),
    },
    option: (i) => ({
      id: `${base}-${i}`,
      role: 'option',
      'aria-selected': i === cursor,
      onClick: () => { setCursor(i); onPress(i); },
      onPointerEnter: (e) => setHover({ i, rect: e.currentTarget.getBoundingClientRect() }),
      onPointerLeave: () => setHover(null),
    }),
  };
}
