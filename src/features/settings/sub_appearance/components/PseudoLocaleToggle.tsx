import { useState } from 'react';

const LS_KEY = 'personas-pseudo-locale';

function readFlag(): boolean {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

export default function PseudoLocaleToggle() {
  const [on, setOn] = useState(readFlag);

  const toggle = () => {
    const next = !on;
    try {
      if (next) localStorage.setItem(LS_KEY, '1');
      else localStorage.removeItem(LS_KEY);
    } catch { /* storage unavailable */ }
    setOn(next);
    window.location.reload();
  };

  return (
    <div className="px-4 pb-4 pt-2 border-t border-amber-500/20">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          className="mt-1 h-4 w-4 cursor-pointer accent-amber-500"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Pseudo-locale (⟦àççéñţšʼ⟧)</span>
          <span className="text-xs text-foreground/60">
            Wraps every translated string in brackets with accented letters.
            Any text NOT bracketed is hardcoded English that bypassed i18n.
            Reloads on toggle. Also: <code>?pseudo=1</code> URL param, or
            <code>window.__togglePseudoLocale__()</code> in console.
          </span>
        </span>
      </label>
    </div>
  );
}
