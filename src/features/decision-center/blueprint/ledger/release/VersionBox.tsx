import { useSheet } from '../../controller/SheetContext';
import type { ReleaseModel } from '../../model/ledgerRelease';
import { Btn } from '../Controls';
import type { BpOpen } from '../useBpOpen';
import { releaseWord } from '../words';

/**
 * The Release tab's version box (bp VersionBox), read-only: with no open release, the suggested next version, what it
 * came from and why, and Create draft, which opens bp's Release tab (a draft is cut there); with a release, its
 * version, id, branch and status.
 */
export function VersionBox({ m, bp }: { m: ReleaseModel; bp: BpOpen }) {
  const { B, tx } = useSheet().text;
  const rel = m.rel, sug = m.suggestion;
  return (
    <div className="tr-rel-ver" data-testid="blueprint-ledger-version">
      <span className="lbl">{B.lg_rel_version}</span>
      <span className="vin">
        <span aria-hidden="true">v</span>
        <output className="vv">{rel ? rel.version : sug.version}</output>
        {!rel ? <Btn tone="go" tip={B.lg_in_bp_tip} onClick={bp.openRelease} disabled={!bp.releaseUrl || !m.items.length} testId="blueprint-ledger-rel-cut">{B.lg_rel_create + ' ↗'}</Btn> : null}
      </span>
      <span className="why">
        {rel
          ? <>{B.lg_rel_release} <code>{rel.id}</code> {B.lg_rel_on} <code>{rel.branch}</code> · {releaseWord(B, rel.status)}{rel.created_by ? ' · ' + rel.created_by : ''}</>
          : <>{tx(B.lg_rel_suggested, { v: sug.version, from: sug.from })} <span className="dim">{sug.reason}</span></>}
      </span>
    </div>
  );
}
