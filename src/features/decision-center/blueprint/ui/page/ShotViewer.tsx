// The Screens viewer (bp sheet/Screens.tsx Viewer): two takes of one size and theme, A and B (default: the latest two),
// side by side or as a swipe. bp picks A and B with native selects; here each is a strip of run presses (the shared
// rule on raw selects), the same choice in the same place. Esc closes the viewer before anything else on the page.
import { useEffect, useRef, useState } from 'react';
import type { Run, Shot } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { ShotImg } from '../compare/ShotFrame';
import { Press } from '../Press';

export interface Take { id: string; run: Run | null; shot: Shot }

/** Console errors a shot's harness report records (a count, or a list), 0 when it says nothing. */
export function shotErrors(x: Shot): number {
  const c = x.report?.consoleErrors;
  return typeof c === 'number' ? c : Array.isArray(c) ? c.length : 0;
}

function useRunLabel(): (t: Take) => string {
  const { language } = useSheet().text;
  return (t) => {
    const at = Date.parse(t.run?.started_at ?? t.shot.captured_at);
    const when = Number.isNaN(at) ? '' : new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(at);
    return when + ' · ' + t.shot.run_id + (t.shot.phase ? ' · ' + t.shot.phase : '');
  };
}

function Figure({ t, alt }: { t: Take; alt: string }) {
  const { B, tx } = useSheet().text, label = useRunLabel(), n = shotErrors(t.shot);
  return (
    <figure className="bp-fig">
      <figcaption className="typo-code"><span>{label(t)}</span>{n ? <span className="err">{tx(B.pg_shot_errors, { count: n })}</span> : null}</figcaption>
      <div className="bp-scr"><ShotImg shot={t.shot} alt={alt} /></div>
    </figure>
  );
}

export function ShotViewer({ k, takes, name, close }: { k: string; takes: Take[]; name: string; close: () => void }) {
  const { B, tx } = useSheet().text, label = useRunLabel();
  const [a, setA] = useState(Math.min(1, takes.length - 1)), [b, setB] = useState(0);
  const [mode, setMode] = useState<'side' | 'swipe'>('side');
  const ref = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, []);
  const A = takes[a]!, Bt = takes[b]!, two = takes.length > 1;
  const pick = (v: number, set: (n: number) => void, which: string) => (
    <span className="pick">{which}
      <span className="seg" role="group" aria-label={tx(B.pg_shot_pick, { which })}>
        {takes.map((t, i) => <Press key={t.id} on={v === i} onClick={() => set(i)}>{label(t)}</Press>)}
      </span>
    </span>
  );
  return (
    <div className="shotv" ref={ref} tabIndex={-1} role="region" aria-label={tx(B.pg_screens_region, { name, key: k })}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div className="bar">
        <b>{k}</b>
        {two ? <>{pick(a, setA, 'A')}{pick(b, setB, 'B')}
          <span className="seg" role="group" aria-label={B.cmp_mode_group}>
            <Press on={mode === 'side'} onClick={() => setMode('side')}>{B.cmp_mode_side}</Press>
            <Press on={mode === 'swipe'} onClick={() => setMode('swipe')}>{B.pg_swipe}</Press>
          </span></> : <span className="hint">{B.pg_one_run}</span>}
        <Press tone="btn" onClick={close}>{B.pg_close}</Press>
      </div>
      {!two || mode === 'side' ? (
        <div className={two ? 'pair' : 'one'}>
          {two ? <Figure t={A} alt={tx(B.pg_run_alt, { name, which: 'A' })} /> : null}
          <Figure t={Bt} alt={two ? tx(B.pg_run_alt, { name, which: 'B' }) : name} />
        </div>
      ) : (
        <div>
          <div className="bp-scr" ref={frame}>
            <ShotImg shot={A.shot} alt={tx(B.pg_run_alt, { name, which: 'A' })} />
            <ShotImg shot={Bt.shot} alt={tx(B.pg_run_alt, { name, which: 'B' })} className="bp-top" />
          </div>
          <input type="range" min="0" max="100" defaultValue="50" aria-label={B.pg_swipe_label} className="bp-slide"
            onInput={(e) => frame.current?.style.setProperty('--cut', e.currentTarget.value + '%')} />
          <div className="ends"><span>A · {label(A)}</span><span>B · {label(Bt)}</span></div>
        </div>
      )}
    </div>
  );
}
