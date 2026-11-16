import { useState } from 'react';
import type { Brief, BriefDecided, BriefFact, Match } from '../../model/brief';
import { briefChip, type BriefChip } from '../../model/cardBrief';
import type { BpText } from '../../controller/useBlueprintText';
import { useSheet } from '../../controller/SheetContext';
import { Press } from '../Press';
import '../../styles/brief.css';

/** How many evidence rows a fact opens before "and N more". */
const MAX_EVIDENCE = 8;

const CHIP_KEY = { repeat: 'brief_chip_repeat', like: 'brief_chip_like', mostly: 'brief_chip_mostly' } as const satisfies Record<BriefChip, keyof BpText>;
const MATCH_KEY = {
  'same idea': 'brief_match_same_idea', 'same standard': 'brief_match_same_standard',
  'similar words': 'brief_match_similar_words', 'same lens': 'brief_match_same_lens',
} as const satisfies Record<Match, keyof BpText>;

function Decided({ r, B }: { r: BriefDecided; B: BpText }) {
  return (
    <li className={`bp-bf-v-${r.verdict}`}>
      <span className="bp-bf-vd typo-code">{r.verdict === 'declined' ? B.brief_verdict_declined : B.brief_verdict_approved}</span>
      <span className="typo-body">{r.title}{r.note ? <q>{r.note}</q> : null}</span>
      <small className="typo-code">{r.at} {'·'} {B[MATCH_KEY[r.match]]} {'·'} {r.id}</small>
    </li>
  );
}

/** What a fact's number opens: the decisions it counts, the features that depend on this one, the builds behind the cost. */
function Evidence({ b, f }: { b: Brief; f: BriefFact }) {
  const { B, tx } = useSheet().text;
  const more = (n: number) => (n > MAX_EVIDENCE ? <li className="bp-bf-more typo-caption">{tx(B.brief_more, { count: n - MAX_EVIDENCE })}</li> : null);
  if (f.key === 'precedent' || f.key === 'declined') {
    const rows = f.key === 'declined' ? b.declines : b.precedent.rows;
    return <ol className="bp-bf-ev">{rows.slice(0, MAX_EVIDENCE).map((r) => <Decided key={r.id} r={r} B={B} />)}{more(rows.length)}</ol>;
  }
  if (f.key === 'blast') {
    const deps = b.blast.dependents;
    return <ol className="bp-bf-ev">{deps.slice(0, MAX_EVIDENCE).map((x) => <li key={x.slug}><span className="typo-body">{x.name}</span>{x.id ? <small className="typo-code">{x.id}</small> : null}</li>)}{more(deps.length)}</ol>;
  }
  if (f.key === 'cost') return <ol className="bp-bf-ev">{b.cost.runs.slice(0, MAX_EVIDENCE).map((r) => <li key={r}><small className="typo-code">{tx(B.brief_run, { id: r })}</small></li>)}{more(b.cost.runs.length)}</ol>;
  return null;
}

/**
 * The decision brief on a waiting card (bp apps/web Brief.tsx BriefFacts, ported to the sheet): the advice chip, then
 * one plain line per fact (at most five, the brief's own budget), the declined line in amber. A fact with evidence opens
 * it under its line. The lines are the brief's own words (model/brief.ts, held byte for byte by bp's golden), so the
 * card, bp's card and VR's card say the same thing; only the chrome around them is translated.
 */
export function BriefFacts({ b }: { b: Brief }) {
  const { B } = useSheet().text;
  const [open, setOpen] = useState<string | null>(null);
  const chip = briefChip(b);
  return (
    <section className="bp-brief" aria-label={B.brief_label} data-testid="blueprint-brief" data-advice={b.advice.say}>
      {chip ? <div className={`bp-bf-adv bp-bf-a-${b.advice.say} typo-code`}>{B[CHIP_KEY[chip]]}</div> : null}
      <ul className="bp-bf-facts">
        {b.facts.map((f) => {
          const n = f.ids.length, on = open === f.key;
          return (
            <li key={f.key} className={`bp-bf-${f.key}${on ? ' bp-on' : ''}`} data-fact={f.key}>
              {n ? (
                <Press tone="bp-bf-open" aria-expanded={on} onClick={() => setOpen(on ? null : f.key)}>
                  <span className="typo-body">{f.text}</span><i className="typo-code" aria-hidden="true">{n} {on ? '▴' : '▾'}</i>
                </Press>
              ) : <span className="typo-body">{f.text}</span>}
              {on ? <Evidence b={b} f={f} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
