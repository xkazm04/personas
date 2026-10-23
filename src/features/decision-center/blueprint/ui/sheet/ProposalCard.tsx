import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import { useSheet } from '../../controller/SheetContext';
import { STATUS } from '../../model/states';
import type { WorkItem } from '../../model/work';
import { deltaText } from '../format';
import { LensGlyphIcon } from '../LensGlyphIcon';
import { nextHint, statusWord, StatusChip } from '../StatusChip';
import { OptionRow } from './OptionRow';
import { PackEvidence } from './PackEvidence';

/** What a state leaves to do or to read: the verbs of the proposed and approved states, the store's note otherwise. */
function Tail({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, language } = s.text;
  const pick = () => s.nav.select(p);
  if (p.status === 'proposed') {
    return (
      <>
        <OptionRow k="a" primary label={B.opt_approve} tag={B.opt_suggest} sub={deltaText(s.plan, p, language)} onPress={() => { pick(); void s.writes.approve(p); }} testId="blueprint-approve" busy={s.ui.busy} />
        <OptionRow k="x" label={B.opt_decline} sub={B.opt_decline_sub} onPress={() => { pick(); s.writes.askDecline(p); }} testId="blueprint-decline" />
      </>
    );
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
 * age, size and risk, the filed explanation, and whatever its state offers. Built items in a pack also carry their
 * before/after evidence. The card is the current item when it wears the focus ring.
 */
export function ProposalCard({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const L = s.plan.LENS[p.lens];
  const accent = s.engine ? s.engine.accentOf(p.lens) : undefined;
  const cur = s.ui.itemId === p.id;
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
      {p.body && !p.pack ? <div className="bp-pb"><DeferredMarkdown content={p.body} variant="card" /></div> : null}
      {p.pack ? <PackEvidence p={p} /> : null}
      <Tail p={p} />
    </article>
  );
}
