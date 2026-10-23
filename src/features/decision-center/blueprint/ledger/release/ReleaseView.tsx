import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { conflictsOf, releaseModel } from '../../model/ledgerRelease';
import { Btn, Callout } from '../Controls';
import { useBpOpen } from '../useBpOpen';
import { History } from './History';
import { NotesPreview } from './NotesPreview';
import { Package } from './Package';
import { Stepper } from './Stepper';
import { VersionBox } from './VersionBox';

/**
 * The ledger's Release tab, READ-ONLY (bp ReleaseView): the package (version, the accepted items by lens, the rework
 * queue, the descoped) on the left; the build (stepper, the action for where the release stands, the notes it will
 * publish, the history) on the right. Every write control (Create draft, Build, Finish, Undo) opens bp's Release tab
 * at this product instead (operator decision): Personas shows the train, bp drives it. No `actions.*` call here.
 */
export function ReleaseView() {
  const s = useSheet();
  const { B, tx } = s.text;
  const bp = useBpOpen();
  const m = useMemo(() => releaseModel(s.data.scan, s.plan.lenses), [s.data.scan, s.plan.lenses]);
  const rel = m.rel, n = m.items.length, ver = rel?.version ?? m.suggestion.version;
  const act = !rel ? null : rel.status === 'draft' ? tx(B.lg_rel_build, { v: rel.version }) : rel.status === 'failed' ? B.lg_rel_retry
    : rel.status === 'pr-open' || rel.status === 'merged' ? tx(B.lg_rel_finish, { v: rel.version }) : null;
  const hint = !rel ? B.lg_rel_hint_none : B[`lg_rel_hint_${rel.status === 'pr-open' ? 'pr_open' : rel.status}` as const];
  return (
    <div className="tr-rel" data-testid="blueprint-ledger-release">
      <section aria-label={B.lg_package}>
        <h3>{rel ? tx(B.lg_rel_pkg_in, { n, v: rel.version }) : tx(B.lg_rel_pkg, { n })}</h3>
        <VersionBox m={m} bp={bp} />
        <Package m={m} bp={bp} />
      </section>
      <section aria-label={B.lg_rel_build_label}>
        <h3>{B.lg_rel_build_head}</h3>
        <Stepper rel={rel} />
        {rel?.status === 'failed' ? <Callout tone="error" testId="blueprint-ledger-rel-failed"><b>{B.lg_rel_failed} · </b>{rel.error ?? B.lg_rel_failed_why}</Callout> : null}
        <div className="tr-rel-acts">
          {act ? <Btn tone="go" tip={B.lg_in_bp_tip} onClick={bp.openRelease} disabled={!bp.releaseUrl} testId="blueprint-ledger-rel-act">{act + ' ↗'}</Btn> : null}
          {rel?.pr_url ? <Btn tip={B.lg_in_bp_tip} onClick={bp.openRelease} disabled={!bp.releaseUrl}>{'⇱ ' + B.lg_rel_pr}</Btn> : null}
        </div>
        <p className="tr-rel-hint">{tx(hint, { v: ver, n })}</p>
        <NotesPreview m={m} version={ver} conflicts={conflictsOf(m.rework, rel)} />
        <History m={m} />
      </section>
    </div>
  );
}
