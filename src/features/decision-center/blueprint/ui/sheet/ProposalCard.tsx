import { useMemo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import { useSheet } from '../../controller/SheetContext';
import type { Brief } from '../../model/brief';
import { cardBrief, isRepeat } from '../../model/cardBrief';
import { STATUS } from '../../model/states';
import type { WorkItem } from '../../model/work';
import { deltaText } from '../format';
import { LensGlyphIcon } from '../LensGlyphIcon';
import { nextHint, statusWord, StatusChip } from '../StatusChip';
import { BriefFacts } from './BriefFacts';
import { OptionRow } from './OptionRow';
import { PackEvidence } from './PackEvidence';

/**
 * What a state leaves to do or to read: the verbs of the proposed and approved states, the store's note otherwise.
 * A waiting item reads its brief: on a repeat of a declined idea (identity, never likeness) Decline is the first answer,
 * tagged, and Approve stays as "approve anyway"; the decline prompt then opens with the note naming the decision it
 * repeats (ReasonDialog). A like idea declined elsewhere only shows the decline in amber: Approve stays first.
 */
function Tail({ p, brief }: { p: WorkItem; brief: Brief | null }) {
  const s = useSheet();
  const { B, language } = s.text;
  const pick = () => s.nav.select(p);
  if (p.status === 'proposed') {
    const repeat = isRepeat(brief);
    const approve = <OptionRow k="a" primary={!repeat} label={repeat ? B.opt_approve_anyway : B.opt_approve} tag={repeat ? undefined : B.opt_suggest} sub={deltaText(s.plan, p, language)} onPress={() => { pick(); void s.writes.approve(p); }} testId="blueprint-approve" busy={s.ui.busy} />;
    const decline = <OptionRow k="x" primary={repeat} repeat={repeat} label={B.opt_decline} tag={repeat ? B.opt_declined_before : undefined} sub={repeat ? B.opt_decline_repeat_sub : B.opt_decline_sub} onPress={() => { pick(); s.writes.askDecline(p); }} testId="blueprint-decline" />;
    return repeat ? <>{decline}{approve}</> : <>{approve}{decline}</>;
  }
  if (p.status === 'approved') return <OptionRow k="b" primary label={B.opt_arm} tag={B.opt_approved_here} sub={B.opt_arm_sub} onPress={() => { pick(); s.writes.arm(); }} testId="blueprint-arm" />;
  const note = p.row.status === 'declined' ? p.row.decision_note : p.row.triage_note;
  return (
    <div className={`bp-done bp-tone-${STATUS[p.status].tone}`}>
      <span className="typo-eyebrow">{statusWord(B, p.status)}</span> {note ? `“${note}”` : nextHint(B, p.status)}
      {p.row.release_id ? <> {'·'} <span className="typo-code">{p.row.release_id}</span></> : null}
    </div>
  );
}

/**
 * One piece of work on a feature (bp FeatureSheet "The scan on this feature"): glyph, title, state chip, id, lens,
 * age, size and risk, the decision brief while it waits, the filed explanation, and whatever its state offers. Built items in a pack also carry their
 * before/after evidence. The card is the current item when it wears the focus ring.
 */
export function ProposalCard({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const L = s.plan.LENS[p.lens];
  const accent = s.engine ? s.engine.accentOf(p.lens) : undefined;
  const cur = s.ui.itemId === p.id;
  const brief = useMemo(() => cardBrief(s.data, s.plan, p), [s.data, s.plan, p]);
  return (
    <article className={`bp-prop bp-tone-${STATUS[p.status].tone}${p.pack ? ' bp-pack' : ''}`} aria-current={cur ? 'true' : undefined} data-item={p.id} data-status={p.status}>
      <div className="bp-ph">
        <span className="bp-g" style={accent ? { color: accent } : undefined}><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
        <h4 className="bp-pt typo-body">{p.title}</h4>
        <StatusChip B={B} status={p.status} />
      </div>
      <div className="bp-pm typo-body">
        <span className="typo-code">{p.id}</span>
        <span>{L?.name ?? p.lens}</span>
        {p.pack ? <span className="typo-code">{p.pack}{p.row.commit_sha ? ` · ${p.row.commit_sha.slice(0, 8)}` : ''}</span> : <span>{B.filed} <RelativeTime timestamp={p.created} showTooltip={false} /></span>}
        <span className="typo-code">{tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })}</span>
      </div>
      {brief ? <BriefFacts b={brief} /> : null}
      {p.body && !p.pack ? <div className="bp-pb"><DeferredMarkdown content={p.body} variant="card" /></div> : null}
      {p.pack ? <PackEvidence p={p} /> : null}
      <Tail p={p} brief={brief} />
    </article>
  );
}
