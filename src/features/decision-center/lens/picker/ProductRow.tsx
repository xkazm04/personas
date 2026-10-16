/**
 * ProductRow - one lens-scan product as bp's manage-dialog row (bp `components/ProjectsDialog.tsx` Row,
 * `projects.css` .pj-row): the name and its slug, the readiness chip (LevelIcon + word), the repo root, the
 * store's counts, the readiness checklist and the two doors. bp's rename / change-root / remove edits are
 * not here: Personas owns the project list in its own Projects page, so this row only opens.
 *
 * The doors are the blueprint's one press target (`blueprint/ui/Press`) in bp's `.pj-bt` dress: OPEN THE
 * BLUEPRINT in the accent fill, OPEN THE RELEASE beside it when a release waits on the person.
 */
import type { LensScanProduct } from '@/api/lensScan';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { Press } from '../../blueprint/ui/Press';
import type { ReadinessLevel } from '../../blueprint/source';
import { openLensSheet } from '../lensSheetStore';
import { readinessLevel } from '../readiness';
import { Checklist } from './Checklist';
import { LevelIcon } from './LevelIcon';

type LensCopy = ReturnType<typeof useTranslation>['t']['decisionCenter']['lens'];

/** A release waits on the person, or accepted items wait for one. */
const hasRelease = (p: LensScanProduct): boolean => !!p.openRelease || p.unreleasedAccepted > 0;

/** bp's slug is the registry key; a Personas project has none, so the repo folder's name stands in. */
export function slugOf(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return (parts[parts.length - 1] ?? root).toLowerCase();
}

export function levelWords(L: LensCopy, level: ReadinessLevel): { label: string; tip: string } {
  switch (level) {
    case 'missing': return { label: L.level_missing, tip: L.level_tip_missing };
    case 'map-only': return { label: L.level_map_only, tip: L.level_tip_map_only };
    case 'measured': return { label: L.level_measured, tip: L.level_tip_measured };
    case 'full': return { label: L.level_full, tip: L.level_tip_full };
  }
}

export function ProductRow({ p }: { p: LensScanProduct }) {
  const { t, tx } = useTranslation();
  const L = t.decisionCenter.lens;
  const level = readinessLevel(p);
  const words = levelWords(L, level);
  return (
    <li className="pj-row" data-testid={`blueprint-product-${p.projectId}`} data-level={level}>
      <div className="pj-top">
        <div className="pj-id">
          <b>{p.name}</b>
          <code>{slugOf(p.root)}</code>
        </div>
        <Tooltip content={words.tip}>
          <span className="pj-lv" tabIndex={0}>
            <LevelIcon level={level} />
            {words.label}
          </span>
        </Tooltip>
      </div>
      <div className="pj-root">{p.root}</div>
      {!p.error && (
        <p className="pj-counts">
          {tx(L.product_counts, { proposed: p.counts.proposed ?? 0, approved: p.counts.approved ?? 0, triage: p.awaitingTriage })}
          {p.openRelease && <span className="pj-rel">{tx(L.release_line, { id: p.openRelease.id, status: p.openRelease.status })}</span>}
        </p>
      )}
      <Checklist p={p} />
      {!p.hasMap && <p className="pj-hint">{L.map_hint}</p>}
      {p.error && (
        <p className="pj-err">
          {L.error_store}
          <code>{p.error}</code>
        </p>
      )}
      <div className="pj-acts">
        <Press
          tone="pj-bt go"
          onClick={() => openLensSheet({ kind: 'build', projectId: p.projectId })}
          data-testid={`blueprint-open-${p.projectId}`}
        >
          {L.open_blueprint}
        </Press>
        {!p.error && hasRelease(p) && (
          <Press tone="pj-bt" onClick={() => openLensSheet({ kind: 'release', projectId: p.projectId })} data-testid={`blueprint-release-${p.projectId}`}>
            {L.open_release}
          </Press>
        )}
      </div>
    </li>
  );
}
