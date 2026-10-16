// The work on this feature, in bp's swarm box (sheet/SheetBody.tsx SwarmSection: "The scan on this feature"): the
// Personas addition bp's page does not carry and the operator decides from. The pack's built items (each opens the
// compare panel) in their own box, then the scan's proposals with their approve / decline / build controls
// (ProposalCard, OptionRow). On a lens tab only that lens's work shows (bp: "Questions and orders under <lens>").
import { useSheet } from '../../controller/SheetContext';
import { isBuilt } from '../../model/triage';
import type { WorkItem } from '../../model/work';
import { PackRow } from '../sheet/PackRow';
import { ProposalCard } from '../sheet/ProposalCard';

export function useFeatureWork(fid: string, lens: string): { packed: WorkItem[]; rest: WorkItem[] } {
  const s = useSheet();
  const mine = (s.work.byFeature.get(fid) ?? []).filter((p) => lens === 'general' || p.lens === lens);
  const packed = mine.filter((p) => p.pack && p.status !== 'proposed' && p.status !== 'approved');
  return { packed, rest: mine.filter((p) => !packed.includes(p)) };
}

/** The pack's items on this feature: built ones as rows that open the compare, the rest as cards. Null when none. */
export function PackBox({ packed }: { packed: WorkItem[] }) {
  const { B, tx } = useSheet().text;
  if (!packed.length) return null;
  return (
    <div className="swm pk" data-testid="blueprint-page-pack">
      <h4>{tx(B.pack_box, { id: packed[0]?.pack ?? '', count: packed.length })}</h4>
      {packed.map((p) => (isBuilt(p) ? <PackRow key={p.id} p={p} /> : <ProposalCard key={p.id} p={p} />))}
    </div>
  );
}

/** The scan's open work on this feature, with its controls; says so when there is none. */
export function ScanBox({ rest, lens }: { rest: WorkItem[]; lens: string }) {
  const s = useSheet(), { B, tx } = s.text;
  const name = s.plan.LENS[lens]?.name ?? '';
  const waiting = rest.filter((p) => p.status === 'proposed').length;
  return (
    <div className="swm" data-testid="blueprint-page-work">
      <h4>{lens === 'general' ? tx(B.scan_heading, { count: waiting }) : tx(B.pg_work_under, { lens: name, count: waiting })}</h4>
      {rest.length ? rest.map((p) => <ProposalCard key={p.id} p={p} />)
        : <p className="none">{lens === 'general' ? B.nothing_on_feature : tx(B.nothing_under_lens, { lens: name })}</p>}
    </div>
  );
}

/** Both boxes, the pack first. */
export function WorkSection({ fid, lens }: { fid: string; lens: string }) {
  const { packed, rest } = useFeatureWork(fid, lens);
  return <><PackBox packed={packed} /><ScanBox rest={rest} lens={lens} /></>;
}
