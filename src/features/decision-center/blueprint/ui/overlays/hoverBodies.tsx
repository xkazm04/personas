// The hover card's bodies (PORTED from bp src/components/Overlays.tsx HoverBody): a fixture (kicker, name, the plain
// stage on the date shown, the lens's evidence, what is in trouble and what waits), a place (a room or, at the site
// level, its wing: kicker, name, summary, the 8 px stacked stage bar and its counts) and a cluster of trouble flags.
// EDIT (port): bp's agent, pin and swarm lines and the 96x64 place illustration have no data here and are not brought.
import type { Sheet } from '../../controller/SheetContext';
import type { Feature } from '../../standard/load';
import type { RoomNode, WingNode } from '../../model/layout';
import { lensContent } from '../../engine/lens';
import { countsAt } from '../../engine/travel';
import type { FlagBox } from '../../engine/types';
import { formatPercent } from '@/lib/utils/formatters';

const PLAIN = {
  live: 'plain_live', flagged: 'plain_flagged', 'in-review': 'plain_in_review', 'in-dev': 'plain_in_dev',
  specified: 'plain_specified', idea: 'plain_idea', deprecated: 'plain_deprecated',
} as const;

/** The plain stage line of a feature on the date shown (bp plainStage): now, the rollout or the build progress joins it. */
function plainStage(s: Sheet, f: Feature): string {
  const { B, tx, language } = s.text, e = s.engine, st = e ? e.stageOf(f) : f.stage, now = !e || e.isNow;
  if (!st) return now ? B.plain_none : B.hov_not_yet;
  if (now && e) {
    const lv = e.live(f), pct = (n: number) => formatPercent(n, { language, precision: 0 });
    if (st === 'flagged' && lv.rolloutPct < 100) return tx(B.hov_flagged_pct, { pct: pct(lv.rolloutPct) });
    if (st === 'in-dev' && lv.progressPct > 0) return tx(B.hov_in_dev_pct, { pct: pct(Math.round(lv.progressPct)) });
  }
  return B[PLAIN[st]];
}

export function TileBody({ s, f, flag }: { s: Sheet; f: Feature; flag: FlagBox | null }) {
  const { B, tx } = s.text, e = s.engine, now = !e || e.isNow, T = s.plan.L.TILE[f.id];
  const lens = s.ui.lens !== 'general' ? s.plan.LENS[s.ui.lens] : undefined;
  const lw = now && lens && e ? lensContent(s.words, lens, f, e.live(f)).parts.join(' · ') : '';
  const waiting = now ? (s.work.byFeature.get(f.id) ?? []).filter((p) => p.status === 'proposed').length : 0;
  const trouble = now ? (flag ? f.trouble.filter((t) => t.lens === flag.lens) : f.trouble).slice(0, 3) : [];
  return (
    <>
      <div className="k">{f.code ? f.code + ' · ' : ''}{T?.room.d.name ?? f.domain} {'›'} {T?.bay.cap.name ?? f.capability}</div>
      <div className="n">{f.name}</div>
      <div className="s">{plainStage(s, f)}.</div>
      {lw && <div className="e">{lw}</div>}
      {trouble.length > 0 && <div className="t">{trouble.map((t) => <div key={t.lens} className={t.h === 'watch' ? 'w' : undefined}>{'◆'} {s.plan.LENS[t.lens]?.name ?? t.lens}: {t.why}</div>)}</div>}
      {waiting > 0 && <div className="sw q">{tx(B.count_waiting, { count: waiting })}</div>}
      <div className="h">{B.hov_hint_tile}</div>
    </>
  );
}

export function PlaceBody({ s, o }: { s: Sheet; o: RoomNode | WingNode }) {
  const { B, tx } = s.text, e = s.engine, now = !e || e.isNow, W = s.words;
  const c = countsAt(o.feats, (f) => (e ? e.stageOf(f) : f.stage)), tot = Math.max(1, c.n);
  const bad = now ? o.feats.filter((f) => f.health === 'bad').length : 0;
  const room = o.kind === 'room';
  const kick = room ? tx(B.hov_room_kicker, { letter: o.wing.def.letter, wing: o.wing.def.name }) : tx(B.hov_wing_kicker, { letter: o.def.letter });
  const parts = [W.featuresN(c.n), W.live(c.live + c.flagged), W.building(c.build), W.onPaper(c.paper)];
  const segs: [number, string][] = [[c.live, 'a85'], [c.flagged, 'a50'], [c.build, 'a25'], [c.paper + c.none, 'a08']];
  return (
    <>
      <div className="k">{kick}</div>
      <div className="n">{room ? o.d.name : o.def.name}</div>
      <div className="s">{room ? o.d.summary : o.def.plain}</div>
      <div className="bar" aria-hidden="true">
        {segs.map(([n, a]) => (n ? <i key={a} className={a} style={{ width: (100 * n) / tot + '%' }} /> : null))}
        {c.dep ? <i className="dep" style={{ width: (100 * c.dep) / tot + '%' }} /> : null}
      </div>
      <div className="e">{parts.join(' · ')}</div>
      {bad > 0 && <div className="t">{W.inTrouble(bad)}</div>}
      <div className="h">{B.hov_hint_place}</div>
    </>
  );
}

export function ClusterBody({ s, flag }: { s: Sheet; flag: FlagBox }) {
  const { B, tx } = s.text;
  const names = [...new Set(flag.lenses.map((l) => s.plan.LENS[l]?.name ?? l))].join(', ');
  return (
    <>
      <div className="k">{names}</div>
      <div className="n q">{tx(B.tip_cluster, { count: flag.fids.length })}</div>
      <div className="h">{B.tip_split}</div>
    </>
  );
}
