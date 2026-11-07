/**
 * The one props bag the Standup page renders from. Data, view model and the
 * keyboard controller live in StandupPanel; the page is presentation only.
 */
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { StandupSource } from '../data/types';
import type { StandupView } from '../model/types';
import type { useStandupController } from '../useStandupController';

export type StandupController = ReturnType<typeof useStandupController>;

export interface StandupPageProps {
  view: StandupView;
  source: StandupSource;
  /** ui (sel, typing, decide, dossier, rules, keys, zoom) + select/pick/typed/set/arm/amend/end. */
  c: StandupController;
  /** The table region is loading its first data. */
  loading: boolean;
  rules: AwayRules | null;
}
