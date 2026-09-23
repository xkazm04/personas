// The Cadastre: the Features page as a land registry. The context map is
// drawn as parcels per district coloured by the claim on each one, the open
// ground is visible as shape, the register on the left is sorted by whose
// move it is, and a deed opens as a full-scale nested layer over the map
// with the weighted-wedge rating figure.
//
// Promotion of the contest winner features-page-r2 A/2 (owner-chosen
// 2026-09-23). The visual contract is the winner's captured style contract
// at `.claude/features-reference/style-contract/` (machine-local); every
// build of this tree is checked against it to zero deviations, and the
// plan is `docs/design/promotions/2026-09-23-council-hud-and-cadastre.md`.
//
// This is the WP0 stub: it fixes the props the page hands the variant, so
// the port (WP1) and the dispatcher never disagree about the wire, and it
// says so on screen rather than drawing a guess.
import type { RefObject } from 'react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { Translations } from '@/i18n/en';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';
import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';

import type { FeatureRow } from '../featureRules';
import type { FeaturesModel } from '../featuresModel';

export interface CadastrePageProps {
  board: FeatureBoard;
  model: FeaturesModel;
  /** True while the checked-in fixture is on: every write is refused. */
  fixture: boolean;
  /** `/` lands here, exactly as it does on the Board. */
  filterRef: RefObject<HTMLInputElement | null>;
  onOpenContext: () => void;
  onOpenDecision: (subjectId: string) => void;
  onRunCouncil: (row: FeatureRow) => void;
  onToggleTier: (row: FeatureRow) => Promise<void>;
  onUpsertScenario: (input: UpsertScenarioInput) => Promise<void>;
  onDeleteScenario: (id: string) => Promise<void>;
  t: Translations['features'];
  tDev: Translations['plugins']['dev_tools'];
  tCommon: { save: string; cancel: string; delete: string };
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function CadastrePage({ t }: CadastrePageProps) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-6"
      data-role="cad-page"
      data-testid="features-cadastre"
    >
      <ScenarioEmptyState title={t.cadastre_pending_title} subtitle={t.cadastre_pending_subtitle} />
    </div>
  );
}

export default CadastrePage;
