// The foot of the left column: the instrument switch (three named segments,
// `M` printed beside them, a live region that announces the new mode), then
// Fit / Lens / Find, then the keys. Every control says what it will do on
// hover AND on keyboard focus, before it is pressed.
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import type { GalaxyEngine } from '../engine/GalaxyEngine';
import { HUD_MODES } from './hudMode';
import { useFusedStore, type SayTarget } from './fusedStore';
import { useFusedStrings } from './fusedStrings';

/** Key legends, as printed on the keys: not prose, so not translated. */
const KEY_ENTER = 'Enter';
const KEY_ESC = 'Esc';

/** The flash on the lit segment runs this long; the caption a little longer. */
const FLASH_MS = 1400;

function sayOn(set: (s: SayTarget | null) => void, kind: string) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => set({ kind, rect: e.currentTarget.getBoundingClientRect() }),
    onFocus: (e: FocusEvent<HTMLElement>) => set({ kind, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => set(null),
    onBlur: () => set(null),
  };
}

export function HudCommands({ engine }: { engine: GalaxyEngine | null }) {
  const s = useFusedStrings();
  const f = s.f;
  const mode = useFusedStore((st) => st.mode);
  const flash = useFusedStore((st) => st.flash);
  const lensOn = useFusedStore((st) => st.lensOn);
  const setMode = useFusedStore((st) => st.setMode);
  const setLensOn = useFusedStore((st) => st.setLensOn);
  const setSay = useFusedStore((st) => st.setSay);
  const setFinderOpen = useFusedStore((st) => st.setFinderOpen);
  const [lit, setLit] = useState(false);
  const segRef = useRef<HTMLDivElement | null>(null);

  // `M` lights the segment it landed on and names the mode above it.
  useEffect(() => {
    if (!flash) return;
    setLit(true);
    const active = segRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active) setSay({ kind: 'flash', rect: active.getBoundingClientRect() });
    const t1 = window.setTimeout(() => setLit(false), FLASH_MS);
    const t2 = window.setTimeout(() => {
      if (useFusedStore.getState().say?.kind === 'flash') setSay(null);
    }, FLASH_MS + 800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [flash, setSay]);

  return (
    <>
      <div className={`fz-modes${lit ? ' flash' : ''}`} role="group" aria-label={f.modes_label} data-role="hud-modes">
        <div className="seg" ref={segRef}>
          {HUD_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === mode}
              data-role="hud-mode"
              data-mode={m}
              onClick={() => setMode(m)}
              {...sayOn(setSay, `mode:${m}`)}
            >
              {s.modeName(m)}
            </button>
          ))}
        </div>
        <kbd>M</kbd>
      </div>
      <div className="sr" aria-live="polite">
        {tx(f.mode_live, { name: s.modeName(mode) })}
      </div>
      <div className="fz-cmds" data-role="hud-commands">
        <button className="cmd" type="button" data-role="hud-command" onClick={() => engine?.reframe()} {...sayOn(setSay, 'fit')}>
          {f.cmd_fit} <kbd>F</kbd>
        </button>
        <button
          className="cmd"
          type="button"
          data-role="hud-command"
          aria-pressed={lensOn}
          onClick={() => setLensOn(!lensOn)}
          {...sayOn(setSay, 'lens')}
        >
          {f.cmd_lens} <kbd>L</kbd>
        </button>
        <button className="cmd" type="button" data-role="hud-command" onClick={() => setFinderOpen(true)} {...sayOn(setSay, 'find')}>
          {f.cmd_find} <kbd>/</kbd>
        </button>
      </div>
      <div className="keys" data-role="hud-keys">
        <kbd>↑</kbd>
        <kbd>↓</kbd> {f.keys_choose} · <kbd>{KEY_ENTER}</kbd> {f.keys_in} · <kbd>{KEY_ESC}</kbd> {f.keys_out}
      </div>
    </>
  );
}

export default HudCommands;
