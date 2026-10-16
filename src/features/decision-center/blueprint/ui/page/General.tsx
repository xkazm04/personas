// The feature page's General tab (bp page/General.tsx): the overview, not everything. What it is and how it is doing
// in plain words, one headline tile per enabled lens (a tile opens that lens's tab), the work on it (the scan's
// proposals with their controls), Business when the map has it, what it depends on and what depends on it, where it
// lives in code, and the recent activity. The side column keeps the record (Record.tsx).
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import { fval, type Feature } from '../../standard/load';
import { formatPercent } from '@/lib/utils/formatters';
import { Press } from '../Press';
import { useAsOf } from './bits';
import { BusinessSection, hasBusiness } from './Business';
import { CodeTree } from './CodeTree';
import { Activity, Dependencies } from './Links';
import { Sec, Stagger } from './motion';
import { stageView } from './readings';
import { RecordColumn, usePerson } from './Record';
import { StatTiles } from './Tiles';
import { dayFmt } from './values';
import { WorkSection } from './Work';

const PLAIN_KEY = {
  live: 'plain_live', flagged: 'plain_flagged', 'in-review': 'plain_in_review', 'in-dev': 'plain_in_dev',
  specified: 'plain_specified', idea: 'plain_idea', deprecated: 'plain_deprecated',
} as const;

/** bp sheet/words.ts plainLine: the stage in plain words (rollout and build progress when known), who built it, what to watch, the red line. */
function Plain({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx, language } = s.text, person = usePerson();
  const { t, now, past } = useAsOf();
  if (past) {
    const sv = stageView(f, t, now);
    const what = sv.at === 'then' ? stageWord(B, sv.stage) : sv.at === 'before' ? B.pg_not_drawn_yet : B.pg_stage_unknown;
    return <p className="plain"><b>{what}</b> {tx(B.pg_plain_past, { date: dayFmt(language, t) })}</p>;
  }
  const pct = (v: unknown) => (typeof v === 'number' ? formatPercent(Math.round(v), { language, precision: 0 }) : null);
  const roll = pct(fval(f, 'operations', 'rolloutPct')), prog = pct(fval(f, 'development', 'progressPct'));
  const strong = f.stage === 'flagged' && roll && fval(f, 'operations', 'rolloutPct') !== 100 ? tx(B.pg_plain_rollout, { pct: roll })
    : f.stage === 'in-dev' && prog ? tx(B.pg_plain_progress, { pct: prog })
    : f.stage ? B[PLAIN_KEY[f.stage]] : B.pg_stage_unknown;
  const rest: string[] = [];
  if (f.builtBy.length) rest.push(tx(B.pg_plain_built_by, { names: f.builtBy.map((id) => person(id).name).join(', ') }));
  const watch = f.trouble.filter((x) => x.h === 'watch').map((x) => (s.plan.LENS[x.lens]?.name ?? x.lens).toLowerCase());
  if (watch.length) rest.push(tx(B.pg_plain_watch, { lenses: watch.join(', ') }));
  const bad = f.trouble.find((x) => x.h === 'bad');
  return (
    <p className="plain">
      <b>{strong}.</b> {rest.join(' ')} {bad ? <span className="bad">{(s.plan.LENS[bad.lens]?.name ?? bad.lens) + ': ' + bad.why.replace(/\.$/, '') + '.'}</span> : null}
    </p>
  );
}

export function GeneralTab({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx } = s.text;
  const blocked = f.blockedBy.filter((x) => s.plan.L.TILE[x]);
  return (
    <>
      <div className="pg-lede">
        <p className="sum">{f.summary}</p>
        <Plain f={f} />
        {blocked.length ? (
          <p className="blk">{B.pg_blocked_by} {blocked.map((x) => <Press key={x} tone="btn" onClick={() => s.nav.openSheet(x)}>{s.plan.L.TILE[x]!.f.name}</Press>)}</p>
        ) : null}
      </div>
      <div className="pg-cols">
        <Stagger className="pg-main">
          <Sec label={B.pg_sec_tiles}><h4 className="pg-h">{tx(B.cards_all, { count: s.plan.lenses.length })}</h4><StatTiles f={f} /></Sec>
          <Sec label={B.pg_sec_work}><WorkSection fid={f.id} lens="general" /></Sec>
          {hasBusiness(f) ? <Sec label={B.pg_sec_business}><BusinessSection f={f} /></Sec> : null}
          <Sec className="deps" label={B.pg_sec_deps}><Dependencies f={f} /></Sec>
          {f.contexts.length ? <Sec label={B.pg_sec_code}><CodeTree f={f} /></Sec> : null}
          <Sec label={B.pg_sec_activity}><Activity f={f} /></Sec>
        </Stagger>
        <Stagger className="pg-side"><RecordColumn f={f} /></Stagger>
      </div>
    </>
  );
}
