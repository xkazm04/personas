// The one action a deed's state allows, with its key (`a`), the tier switch
// (`m`) and "On the map" (`g`), and the reason under them. The action table is
// the page's own (`featureCta`): run or re-run a council opens the dispatch
// chooser, a clean standard-tier pass is promoted after PromoteConfirm shows
// its numbers, a major feature at the gate leaves for the Council page. Every
// write asks first, and the control that started it carries a real spinner
// (AsyncButton) until the write settles.
import { AsyncButton } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { PromoteConfirm } from '@/features/plugins/dev-tools/sub_context/PromoteConfirm';
import { councilCtaLabel } from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { usePercent } from '@/features/companions/curator/council/table/usePercent';

import { featureCta, type FeatureCtaKind } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import type { CadRow } from './cadastreModel';

export type DeedAsk = 'promote' | 'tier' | null;

/** What `a` does for this deed; `none` means the state allows nothing. */
export function deedCta(r: CadRow): FeatureCtaKind {
  const cta = featureCta(r.row.kind, r.row.feature);
  // Already major: promoting again would flip it back. The gate meets it next round.
  return cta === 'promote' && r.row.feature.tier === 'major' ? 'none' : cta;
}

function why(r: CadRow, t: TFeatures): string {
  if (r.row.running) return t.cadastre_why_running;
  switch (r.row.kind) {
    case 'none': return t.cadastre_why_none;
    case 'fail': return t.cadastre_why_fail;
    case 'incomplete': return t.cadastre_why_incomplete;
    case 'rejected': return t.cadastre_why_rejected;
    case 'approved_drifted': return t.cadastre_why_drifted;
    case 'stalled': return t.cadastre_why_stalled;
    case 'ready': return r.row.feature.tier === 'major' ? t.cadastre_why_ready : t.cadastre_why_ready_standard;
    case 'machine_pass': return r.row.feature.tier === 'major' ? t.cadastre_why_promoted : t.cadastre_why_machine_pass;
    case 'approved': return t.cadastre_why_approved;
    default: return '';
  }
}

export interface DeedActionsProps {
  r: CadRow;
  ask: DeedAsk;
  onAsk: (a: DeedAsk) => void;
  busy: DeedAsk;
  onMain: () => void;
  onConfirmPromote: () => Promise<void>;
  onConfirmTier: () => Promise<void>;
  onMap: () => void;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function DeedActions({ r, ask, onAsk, busy, onMain, onConfirmPromote, onConfirmTier, onMap, t, tDev, tx }: DeedActionsProps) {
  const percent = usePercent();
  const { feature } = r.row;
  const cta = deedCta(r);
  const major = feature.tier === 'major';
  const label = cta === 'open_decision' ? t.cta_open_decision : councilCtaLabel(cta, tDev);
  const gate = cta === 'open_decision';

  return (
    <div className="actbar rise" data-role="cad-actions">
      {r.row.running ? (
        <span className="insession"><i aria-hidden="true" />{t.cadastre_in_session}</span>
      ) : cta === 'none' || cta === 'awaiting' ? (
        <span className="nothing">{t.cadastre_nothing}</span>
      ) : (
        <AsyncButton variant="ghost" className={`btn big ${gate ? 'gate' : 'primary'}`} data-role="cad-action" data-testid="cad-action-main" isLoading={busy === 'promote'} onClick={onMain}>
          {label}
          <kbd className="kbd">a</kbd>
        </AsyncButton>
      )}
      <AsyncButton variant="ghost" className="btn ghost" data-testid="cad-action-tier" isLoading={busy === 'tier'} onClick={() => onAsk('tier')}>
        {major ? t.cadastre_make_standard : t.cadastre_make_major}
        <kbd className="kbd">m</kbd>
      </AsyncButton>
      <button type="button" className="btn ghost" onClick={onMap} data-testid="cad-action-map">
        {t.cadastre_on_the_map}
        <kbd className="kbd">g</kbd>
      </button>
      <p className="why">{why(r, t)}</p>

      {ask === 'promote' ? (
        <PromoteConfirm
          facts={{ name: feature.name, overall: feature.council?.overall ?? null, coverage: feature.council?.coverage ?? null, trustState: feature.council?.trustState ?? null }}
          t={tDev}
          percent={percent}
          tx={tx}
          onConfirm={onConfirmPromote}
          onCancel={() => onAsk(null)}
        />
      ) : null}
      {ask === 'tier' ? (
        <ConfirmDialog
          title={tx(major ? t.cadastre_tier_to_standard_title : t.cadastre_tier_to_major_title, { name: feature.name })}
          body={major ? t.cadastre_tier_to_standard_body : t.cadastre_tier_to_major_body}
          confirmLabel={major ? t.cadastre_make_standard : t.cadastre_make_major}
          onConfirm={onConfirmTier}
          onCancel={() => onAsk(null)}
        />
      ) : null}
    </div>
  );
}
