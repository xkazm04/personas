import type { RefObject } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { pct, stationName } from '../../labels';
import { DialEmblem } from './DialEmblem';
import type { KindRow, RepoAtStation, SessionBucket } from './dialDetail';
import { fmtDur, fmtInt } from './dialFormat';
import { kindName } from './dialLabels';
import type { Figure, Ring } from './dialModel';
import { tintVar } from './dialPalette';

export interface SceneProps {
  fig: Figure;
  ring: Ring;
  total: number;
  last: boolean;
  repo: string | null;
  kinds: KindRow[];
  time: { total: number; median: number };
  repos: RepoAtStation[];
  counts: Record<SessionBucket, number>;
  /** how many rows each list may show, from the room the view has */
  rows: number;
  rulerRef: RefObject<HTMLDivElement | null>;
  onOpenSessions: (b: SessionBucket) => void;
  onPickRepo?: (name: string | null) => void;
}

function Key({ tone, num, unit, label, sub, sw }: { tone: string; num: string | number; unit?: string; label: string; sub: string; sw?: string }) {
  return (
    <div className="dial-key-card" data-tone={tone}>
      <b className="typo-data-lg">{num}{unit && <small className="typo-body">{unit}</small>}</b>
      <span className="typo-body text-foreground">{sw && <i className="dial-sw" style={{ background: sw }} aria-hidden="true" />}{label}</span>
      <span className="typo-caption tabular-nums">{sub}</span>
    </div>
  );
}

/** Level 1: one ring unrolled into its ruler, the figures behind it, what the phase is made of, where it fails. */
export function DialScene({ fig: f, ring, total, last, repo, kinds, time, repos, counts, rows, rulerRef, onOpenSessions, onPickRepo }: SceneProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const name = stationName(p, f.keys);
  const vs = (n: number | null | undefined) => (f.vs && n != null ? ` · ${tx(d.k_all, { pct: `${n}%` })}` : '');
  const of = (n: number) => (f.reached ? tx(d.k_of_reached, { pct: `${pct(n, f.reached)}%` }) : '');
  const maxCalls = Math.max(1, kinds[0]?.calls ?? 1);
  const failRepos = repos.filter((r) => r.exits > 0 || r.stumbled > 0).slice(0, rows);
  const maxE = Math.max(1, ...failRepos.map((r) => r.exitPct ?? 0));
  const hours = time.total / 3600;

  return (
    <div className="dial-scene-in" style={{ '--tint': `var(${tintVar(f.keys)})` } as React.CSSProperties}>
      <div className="dial-scene-head">
        <div>
          <span className="dial-fade typo-eyebrow" style={{ '--i': 0 } as React.CSSProperties}>{tx(d.scene_ring, { n: f.index + 1, total })}{repo ? ` · ${repo}` : ''}</span>
          <h2 className="dial-scene-name text-foreground" aria-label={name}>
            {[...name].map((ch, i) => <span key={i} aria-hidden="true" style={{ '--k': i } as React.CSSProperties}>{ch === ' ' ? ' ' : ch}</span>)}
          </h2>
        </div>
        <div className="dial-scene-art dial-fade" style={{ '--i': 1 } as React.CSSProperties}>
          <DialEmblem keys={f.keys} />
          <span className="typo-caption">{d.scene_medallion}</span>
        </div>
        <p className="dial-scene-aside dial-fade typo-body" style={{ '--i': 2 } as React.CSSProperties}>
          {f.rank > 0 && <strong className="text-foreground">{tx(p.rank, { rank: f.rank })} {d.scene_in_view} </strong>}
          {Number.isFinite(f.medWait)
            ? <><strong className="text-foreground">{tx(p.wait, { value: fmtDur(f.medWait) })}</strong> {d.scene_before} · {tx(p.wait_p75, { value: fmtDur(f.p75Wait) })}</>
            : <strong className="text-foreground">{d.scene_start}</strong>}
          {Number.isFinite(time.median) && <><br />{tx(d.scene_time, { median: fmtDur(time.median), total: hours >= 1 ? `${hours.toFixed(1)} h` : fmtDur(time.total) })}</>}
        </p>
      </div>

      <div className="dial-ruler" ref={rulerRef} aria-hidden="true" />

      <div className="dial-keyrow dial-fade" style={{ '--i': 3 } as React.CSSProperties}>
        <Key tone="go" num={f.reachPct} unit="%" label={d.k_reached} sub={`${tx(p.reached, { reached: fmtInt(f.reached), total: fmtInt(f.n) })}${f.skipped ? ` · ${tx(p.skipped, { count: f.skipped })}` : ''}${vs(f.vs?.reachPct)}`} />
        <Key tone="go" num={fmtInt(ring.counts[0])} label={last ? d.k_committed : d.k_went_on} sub={of(ring.counts[0])} sw="var(--color-accent)" />
        <Key tone="clean" num={fmtInt(ring.counts[1])} label={d.k_clean} sub={of(ring.counts[1])} sw="var(--color-status-neutral)" />
        <Key tone="bad" num={fmtInt(f.exits)} label={d.k_failing} sub={`${f.exitPct != null ? tx(d.k_of_reached, { pct: `${f.exitPct}%` }) : d.k_nobody}${vs(f.vs?.exitPct)}`} sw="var(--color-status-error)" />
        <Key tone="warn" num={fmtInt(f.stumbled)} label={d.k_stumbled} sub={`${f.stumblePct != null ? tx(d.k_of_reached, { pct: `${f.stumblePct}%` }) : d.k_nobody}${vs(f.vs?.stumblePct)}`} sw="var(--color-status-warning)" />
      </div>

      <div className="dial-panel dial-fade" style={{ '--i': 4 } as React.CSSProperties}>
        <section aria-label={d.h_kinds}>
          <h3 className="typo-eyebrow">{d.h_kinds}</h3>
          {kinds.slice(0, rows).map((k) => {
            const w = Math.max(2, (100 * k.calls) / maxCalls);
            const ew = k.errors ? Math.max(3, (w * k.errors) / k.calls) : 0;
            return (
              <div className="dial-kind" key={k.kind}>
                <span className="typo-body text-foreground">{kindName(d, k.kind)}</span>
                <div className="dial-kind-bar"><i style={{ width: `${w}%` }} />{ew > 0 && <u style={{ left: `${w - ew}%`, width: `${ew}%` }} />}</div>
                <span className="typo-caption tabular-nums"><b className="text-foreground">{tx(d.kind_calls, { count: fmtInt(k.calls) })}</b> · {k.errors ? <em className="text-status-error">{tx(d.kind_errors, { count: fmtInt(k.errors) })}</em> : d.kind_clean}</span>
              </div>
            );
          })}
          {kinds.length === 0 && <p className="typo-caption">{d.kind_none}</p>}
        </section>
        <section aria-label={d.h_where}>
          <h3 className="typo-eyebrow">{d.h_where}</h3>
          {failRepos.map((r) => (
            <button type="button" key={r.name} data-repo aria-pressed={repo === r.name} disabled={!onPickRepo} onClick={() => onPickRepo?.(repo === r.name ? null : r.name)}>
              <span className="typo-body truncate text-foreground">{r.name}</span>
              <span className="typo-body tabular-nums text-status-error">{r.exitPct == null ? '-' : `${r.exitPct}%`}</span>
              <span className="dial-where-bar"><i style={{ width: `${r.exitPct == null ? 0 : Math.max(2, (100 * r.exitPct) / maxE)}%` }} /></span>
              <span className="typo-caption tabular-nums">{tx(d.where_row, { exits: fmtInt(r.exits), reached: fmtInt(r.reached) })}</span>
            </button>
          ))}
          {failRepos.length === 0 && <p className="typo-caption">{d.where_none}</p>}
        </section>
      </div>

      <div className="dial-acts dial-fade" style={{ '--i': 5 } as React.CSSProperties}>
        {([['failing', 'bad', d.act_failing], ['stumbled', 'warn', d.act_stumbled], ['quiet', '', d.act_quiet]] as const).map(([b, tone, label]) => (
          <button type="button" key={b} data-tone={tone} disabled={counts[b] === 0} onClick={() => onOpenSessions(b)}>
            <b className="typo-body tabular-nums">{fmtInt(counts[b])}</b> <span className="typo-body">{label}</span> <span aria-hidden="true">&rarr;</span>
          </button>
        ))}
      </div>
    </div>
  );
}
