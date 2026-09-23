// The deed's heading inside the layer: an eyebrow with its rank and reach,
// the name at display size (an h2: the page's one h1 is the header band's),
// its state and facts as outlined badges, and the description. Then the one
// reason worth reading: the rejection, the drift, or the council's finding
// (which the board does not carry yet, and says so).
import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { councilLabel } from '@/features/plugins/dev-tools/sub_context/councilGlyph';

import { kindLabel, type TFeatures } from '../featuresModel';
import { standingOf, type CadRow } from './cadastreModel';
import { DeedGlyph } from './DeedGlyph';

interface Props {
  r: CadRow;
  districts: number;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function DeedHead({ r, districts, t, tDev, tx }: Props) {
  const { feature } = r.row;
  const c = feature.council;
  const parcels = feature.contextIds.length;
  return (
    <div className="ly-head rise" data-role="cad-layer-head">
      <div className="eyebrow">{tx(t.cadastre_eyebrow, { rank: r.rank, parcels, districts })}</div>
      <h2 className="deed-title" data-role="cad-layer-title">
        {feature.name}
        {r.dup != null ? <> <span className="dupt">{tx(t.cadastre_copy, { n: r.dup })}</span></> : null}
      </h2>
      <div className="chips">
        <span className={`badge st-${standingOf(r.row.move)}`}>
          <DeedGlyph kind={r.row.kind} tDev={tDev} />
          {councilLabel(r.row.kind, tDev)}
        </span>
        <span className="badge q">{feature.tier === 'major' ? t.cadastre_tier_major : t.cadastre_tier_standard}</span>
        <span className="badge q">{kindLabel(feature.kind, t)}</span>
        {c?.roundNo ? <span className="badge q">{tx(t.cadastre_round_of, { n: c.roundNo })}</span> : null}
        {c?.trustState ? <span className="badge q">{c.trustState === 'trusted' ? tDev.council_trust_trusted : c.trustState === 'untrusted' ? tDev.council_trust_untrusted : tDev.council_trust_uncalibrated}</span> : null}
      </div>
      {feature.description ? <p className="lede">{feature.description}</p> : null}
    </div>
  );
}

export function DeedReason({ r, t, tx }: { r: CadRow; t: TFeatures; tx: Props['tx'] }) {
  const c = r.row.feature.council;
  if (!c) return null;
  if (c.rejectionReason) {
    return (
      <div className="rise">
        <div className="reason rej" data-role="cad-reason">
          <span className="t-label">{tx(t.cadastre_reason_rejected, { n: c.roundNo ?? 1 })}</span>
          <p>{`“${c.rejectionReason}”`}</p>
        </div>
      </div>
    );
  }
  const drift = c.state === 'approved_drifted' && c.drift === 'changed';
  return (
    <div className="rise">
      <div className="reason" data-role="cad-reason">
        <span className="t-label">{drift ? t.cadastre_reason_drift : t.cadastre_reason_finding}</span>
        <p>{drift ? t.cadastre_reason_drift_body : <span className="nmi">{t.cadastre_reason_finding_nm}</span>}</p>
      </div>
    </div>
  );
}
