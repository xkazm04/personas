// Shared pieces of the specimen: the current/proposed split and a live
// readout of what the browser actually computed for a sample.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type Mode = 'current' | 'proposed';
export type View = 'side' | Mode;

/** Renders the same content under both styles. The proposed column carries
 *  [data-style-proposal], which is the only thing that switches the rules. */
export function Split({ view, children }: { view: View; children: (mode: Mode) => ReactNode }) {
  const modes: Mode[] = view === 'side' ? ['current', 'proposed'] : [view];
  return (
    <div className={`sp-cols ${modes.length === 1 ? 'is-single' : ''}`}>
      {modes.map((mode) => (
        <div
          key={mode}
          className="sp-col"
          data-mode={mode}
          {...(mode === 'proposed' ? { 'data-style-proposal': '' } : {})}
        >
          <div className="sp-col-head">
            <span className="typo-label uppercase">{mode === 'current' ? 'Current' : 'Proposed'}</span>
          </div>
          {children(mode)}
        </div>
      ))}
    </div>
  );
}

export function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="sp-section" data-section={id}>
      <div className="sp-section-head">
        <h2 className="typo-heading-lg text-foreground">{title}</h2>
        {note && <span className="typo-caption">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export interface Computed {
  px: string;
  weight: string;
  leading: string;
  tracking: string;
  family: string;
  ownsColour: boolean;
  colour: string;
}

function read(el: HTMLElement): Computed {
  const cs = getComputedStyle(el);
  const parent = el.parentElement ? getComputedStyle(el.parentElement).color : cs.color;
  const size = parseFloat(cs.fontSize);
  const lh = cs.lineHeight === 'normal' ? 'normal' : (parseFloat(cs.lineHeight) / size).toFixed(2);
  const ls = cs.letterSpacing === 'normal' ? '0' : `${(parseFloat(cs.letterSpacing) / size).toFixed(3)}em`;
  return {
    px: `${size.toFixed(1)}px`,
    weight: cs.fontWeight,
    leading: lh,
    tracking: ls,
    family: (cs.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
    ownsColour: cs.color !== parent,
    colour: cs.color,
  };
}

/** A sample plus the spec the browser computed for it, inside a cell that
 *  carries [data-style-proposal] when `mode` is proposed. `env` changes when
 *  the theme or text scale changes, which re-reads the computed style. */
export function Measured({ cls, env, mode, children }: { cls: string; env: string; mode: Mode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [c, setC] = useState<Computed | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    // <html> animates font-size over 150 ms when the text scale changes, and
    // the theme cross-fade class lives 250 ms: read after both settle.
    const id = window.setTimeout(() => setC(read(el)), 400);
    return () => window.clearTimeout(id);
  }, [env, cls]);
  return (
    <div className="sp-cell" data-mode={mode} {...(mode === 'proposed' ? { 'data-style-proposal': '' } : {})}>
      <div className="sp-sample" style={{ color: 'var(--foreground)' }}>
        <span ref={ref} className={cls} style={{ display: 'block' }}>{children}</span>
      </div>
      {c && (
        <span className="typo-caption tabular-nums" data-spec={cls}>
          {c.px} / {c.weight} / lh {c.leading} / tr {c.tracking}
          {c.ownsColour && <span className="sp-flag typo-label">sets colour</span>}
        </span>
      )}
    </div>
  );
}
