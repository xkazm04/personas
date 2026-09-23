// The wire between the Features page and the Cadastre variant, fixed in WP0:
// the Board body takes exactly these, so the dispatcher never disagrees with
// either surface about what it hands them.
import type { RefObject } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
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
  tDev: TDevTools;
  tCommon: { save: string; cancel: string; delete: string };
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}
