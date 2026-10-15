import { useSheet } from '../../controller/SheetContext';
import { LensCards } from './LensCards';
import { ProposalCard } from './ProposalCard';
import { SheetHead } from './SheetHead';
import { SheetSide } from './SheetSide';
import { SheetTabs } from './SheetTabs';

const STAGE_PLAIN_KEY = {
  live: 'plain_live', flagged: 'plain_flagged', 'in-review': 'plain_in_review', 'in-dev': 'plain_in_dev',
  specified: 'plain_specified', idea: 'plain_idea', deprecated: 'plain_deprecated',
} as const;

/**
 * L4, the feature sheet (bp FeatureSheet): laid over the plan, clear of the right rail, the level bar and the
 * timeline. The feature's lens cards (all of them on the overview, one on a lens tab), the work on it split into
 * what is built in a pack and what is still the queue's, and the side tables. Keys are the sheet's own: A, X and B
 * act on the current item here exactly as they do in the queue.
 */
export function FeatureSheet() {
  const s = useSheet();
  const { B, tx } = s.text;
  const fid = s.ui.sheet;
  const T = fid ? s.plan.L.TILE[fid] : undefined;
  if (!fid || !T) return null;
  const f = T.f, sl = s.ui.sheetLens;
  const mine = (s.work.byFeature.get(fid) ?? []).filter((p) => sl === 'general' || p.lens === sl);
  const packed = mine.filter((p) => p.pack && p.status !== 'proposed' && p.status !== 'approved');
  const rest = mine.filter((p) => !packed.includes(p));
  const waiting = rest.filter((p) => p.status === 'proposed').length;
  return (
    <section className="bp-fs" aria-labelledby="bp-sheet-title" data-testid="blueprint-feature-sheet">
      <SheetHead fid={fid} />
      <SheetTabs fid={fid}>
        <div>
          <p className="bp-sum typo-body-lg">{f.summary}</p>
          <p className="bp-plain typo-body">{f.stage ? B[STAGE_PLAIN_KEY[f.stage]] : B.plain_none}</p>
          <div className="typo-eyebrow bp-ink bp-eyebrow">{sl === 'general' ? tx(B.cards_all, { count: s.plan.lenses.length }) : s.plan.LENS[sl]?.name ?? ''}</div>
          <LensCards f={f} lens={sl} />
          {packed.length > 0 && (
            <div className="bp-scan bp-packbox">
              <div className="typo-eyebrow bp-eyebrow">{tx(B.pack_box, { id: packed[0]?.pack ?? '', count: packed.length })}</div>
              {packed.map((p) => <ProposalCard key={p.id} p={p} />)}
            </div>
          )}
          <div className="bp-scan">
            <div className="typo-eyebrow bp-eyebrow">{tx(B.scan_heading, { count: waiting })}</div>
            {rest.length ? rest.map((p) => <ProposalCard key={p.id} p={p} />) : <p className="bp-empty typo-body">{sl === 'general' ? B.nothing_on_feature : tx(B.nothing_under_lens, { lens: s.plan.LENS[sl]?.name ?? '' })}</p>}
          </div>
        </div>
        <SheetSide fid={fid} />
      </SheetTabs>
    </section>
  );
}
