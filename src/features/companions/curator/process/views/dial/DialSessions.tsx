import { useEffect, useMemo, useRef, useState } from 'react';
import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import type { CuratorProcessSession } from '@/lib/bindings/CuratorProcessSession';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevInstance } from '../../engine/devAdapter';
import { outcomeName } from '../../labels';
import { DialSheet } from './DialSheet';
import { DialStrip } from './DialStrip';
import { rawOf, timeline } from './dialDetail';
import { fmtDate, fmtDur } from './dialFormat';

interface SessionsProps {
  title: string;
  sub: string;
  rows: DevInstance[];
  raw: Map<string, CuratorProcessSession>;
  reading: CuratorProcess;
}

const CHUNK = 40;

/** Level 2: the sessions behind a figure, newest first, each with its own step strip; one open in a sheet beside the list. */
export default function DialSessions({ title, sub, rows, raw, reading }: SessionsProps) {
  const { t, tx, language } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const [shown, setShown] = useState(CHUNK);
  const [picked, setPicked] = useState(0);
  const [detail, setDetail] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const tl = useRef(new Map<string, ReturnType<typeof timeline>>());
  const lineOf = (x: DevInstance) => {
    let v = tl.current.get(x.id);
    if (!v) { v = timeline(rawOf(raw, x)!, reading); tl.current.set(x.id, v); }
    return v;
  };

  // A new list starts at its first session.
  useEffect(() => { setShown(CHUNK); setPicked(0); setDetail(false); tl.current.clear(); }, [rows]);
  const visible = useMemo(() => rows.slice(0, shown), [rows, shown]);
  const pick = (i: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, i));
    if (n >= shown) setShown(Math.ceil((n + 1) / CHUNK) * CHUNK);
    setPicked(n);
    requestAnimationFrame(() => document.getElementById(`dial-sx-${n}`)?.scrollIntoView({ block: 'nearest' }));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowDown') pick(picked + 1);
    else if (k === 'ArrowUp') pick(picked - 1);
    else if (k === 'Home') pick(0);
    else if (k === 'End') pick(rows.length - 1);
    else return;
    e.preventDefault();
  };
  const cur = rows[picked];
  const curRaw = cur ? rawOf(raw, cur) : undefined;

  return (
    <section className="dial-sx" data-picked={detail ? '1' : undefined} data-testid="dial-sessions">
      <div>
        <h2 className="typo-heading-lg text-foreground">{title}</h2>
        <p className="typo-caption">{sub}</p>
      </div>
      <div className="dial-sx-body">
        <ul ref={listRef} className="dial-sx-list" role="listbox" aria-label={d.sx_aria} tabIndex={0} aria-activedescendant={cur ? `dial-sx-${picked}` : undefined} onKeyDown={onKey} data-dial-sessions-list>
          {rows.length === 0 && <li role="presentation" className="typo-body p-3">{p.empty}</li>}
          {visible.map((x, i) => {
            const r = rawOf(raw, x);
            if (!r) return null;
            return (
              <li key={x.id} id={`dial-sx-${i}`} role="option" aria-selected={i === picked} onClick={() => { setPicked(i); setDetail(true); }}>
                <i className="dial-od" data-o={x.outcome} aria-hidden="true" />
                <span className="typo-body truncate text-foreground"><span className="font-mono">{x.id}</span> · {x.project} · {r.model?.replace(/^[a-z]+-/, '') ?? ''}</span>
                <span className="typo-caption tabular-nums">{fmtDate(r.start, language)} · {fmtDur(r.active)}</span>
                <DialStrip steps={lineOf(x)} />
              </li>
            );
          })}
          {shown < rows.length && (
            <li role="presentation">
              <button type="button" data-more onClick={() => setShown(shown + CHUNK)}>
                {tx(d.sx_more, { count: Math.min(CHUNK, rows.length - shown), left: rows.length - shown })}
              </button>
            </li>
          )}
        </ul>
        <div className="dial-sx-sheet" aria-live="polite">
          {cur && curRaw && (
            <DialSheet
              session={cur}
              raw={curRaw}
              steps={lineOf(cur)}
              outcome={outcomeName(p, cur.outcome)}
              onBack={() => { setDetail(false); listRef.current?.focus(); }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
