// One feature, expanded: who it is, how it rated, what it claims, where it
// holds by branch, and what has happened to it.
//
// The ONE action comes from the ledger's CTA table plus this page's single
// refinement (`featureCta`): ready AND major leaves for the Council page's
// gate. The decision itself is never made here.
import { useState } from 'react';

import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { CouncilGlyph, councilCtaLabel, councilLabel } from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { PromoteConfirm } from '@/features/plugins/dev-tools/sub_context/PromoteConfirm';
import { VerdictCaption } from '@/features/teams/sub_council/bench/chips';
import { usePercent } from '@/features/teams/sub_council/table/usePercent';

import { featureCta, type FeatureRow } from '../featureRules';
import { kindLabel, type ContextCell, type TFeatures } from '../featuresModel';
import { ScenariosPanel } from '../scenarios/ScenariosPanel';
import { HistoryPanel } from './HistoryPanel';
import { RatingPanel } from './RatingPanel';
import { SlicePanel } from './SlicePanel';

export interface FeatureTabProps {
  row: FeatureRow;
  sliceCells: ContextCell[];
  groupNameById: Map<string, string>;
  onOpenContext: (contextId: string) => void;
  onOpenDecision: (subjectId: string) => void;
  onRunCouncil: (row: FeatureRow) => void;
  onToggleTier: (row: FeatureRow) => Promise<void>;
  onUpsertScenario: (input: UpsertScenarioInput) => Promise<void>;
  onDeleteScenario: (id: string) => Promise<void>;
  t: TFeatures;
  tDev: TDevTools;
  tCommon: { save: string; cancel: string; delete: string };
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function FeatureTab({
  row,
  sliceCells,
  groupNameById,
  onOpenContext,
  onOpenDecision,
  onRunCouncil,
  onToggleTier,
  onUpsertScenario,
  onDeleteScenario,
  t,
  tDev,
  tCommon,
  tx,
  language,
}: FeatureTabProps) {
  const { feature } = row;
  const cta = featureCta(row.kind, feature);
  const subjectId = feature.council?.id ?? null;
  const percent = usePercent();
  const [confirmingPromote, setConfirmingPromote] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="features-feature-tab">
      {/* ONE row: who it is on the left, what you can do about it on the
          right. The description sits under it rather than between them, so the
          tier toggle and the one action never drift apart down the panel. */}
      <header className="flex flex-nowrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="typo-heading-lg text-foreground">{feature.name}</h2>
          <span className="typo-caption">{kindLabel(feature.kind, t)}</span>
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2 py-0.5 typo-caption text-foreground">
            <CouncilGlyph kind={row.kind} t={tDev} />
            {councilLabel(row.kind, tDev)}
          </span>
          {/* Beside the state, never under it: the state word alone reads as
              a verdict the trust state has not earned. */}
          {feature.council && (
            <VerdictCaption
              trustState={feature.council.trustState}
              coverage={feature.council.coverage}
              words={{
                uncalibrated: tDev.council_trust_uncalibrated,
                untrusted: tDev.council_trust_untrusted,
                trusted: tDev.council_trust_trusted,
                unknown: tDev.council_trust_unknown,
                measured: tDev.council_trust_measured,
              }}
              percent={percent}
              tx={tx}
            />
          )}
        </div>

        <div className="flex flex-none items-center gap-3 pt-0.5">
          <Tooltip content={t.tier_toggle_hint}>
            <span>
              <AccessibleToggle
                checked={feature.tier === 'major'}
                onChange={() => void onToggleTier(row)}
                label={t.tier_toggle_label}
              />
            </span>
          </Tooltip>

          {cta === 'open_decision' && subjectId ? (
            <AsyncButton
              variant="primary"
              data-testid="features-open-decision"
              onClick={() => onOpenDecision(subjectId)}
            >
              {t.cta_open_decision}
            </AsyncButton>
          ) : null}
          {cta === 'run' || cta === 'next_round' ? (
            <AsyncButton
              variant="secondary"
              data-testid="features-run-council"
              onClick={() => onRunCouncil(row)}
            >
              {councilCtaLabel(cta, tDev)}
            </AsyncButton>
          ) : null}
          {/* The same confirmation the ledger popover asks, for the same
              reason: promoting hands an existing verdict to a human gate. */}
          {cta === 'promote' ? (
            <AsyncButton
              variant="secondary"
              data-testid="features-promote"
              onClick={async () => setConfirmingPromote(true)}
            >
              {councilCtaLabel(cta, tDev)}
            </AsyncButton>
          ) : null}
        </div>
      </header>

      {feature.description ? (
        <p className="-mt-1 max-w-prose typo-body-lg">{feature.description}</p>
      ) : null}
      {cta === 'open_decision' ? (
        <p className="-mt-3 typo-caption">{t.cta_decision_note}</p>
      ) : null}

      <RatingPanel feature={feature} t={t} tx={tx} language={language} />

      <SlicePanel
        cells={sliceCells}
        primaryContextId={feature.primaryContextId}
        groupNameById={groupNameById}
        onOpenContext={onOpenContext}
        t={t}
        tx={tx}
      />

      <ScenariosPanel
        feature={feature}
        onUpsert={onUpsertScenario}
        onDelete={onDeleteScenario}
        t={t}
        tCommon={tCommon}
        tx={tx}
        language={language}
      />

      <HistoryPanel feature={feature} t={t} tx={tx} />

      {confirmingPromote ? (
        <PromoteConfirm
          facts={{
            name: feature.name,
            overall: feature.council?.overall ?? null,
            coverage: feature.council?.coverage ?? null,
            trustState: feature.council?.trustState ?? null,
          }}
          t={tDev}
          percent={percent}
          tx={tx}
          onConfirm={async () => {
            setConfirmingPromote(false);
            await onToggleTier(row);
          }}
          onCancel={() => setConfirmingPromote(false)}
        />
      ) : null}
    </div>
  );
}
