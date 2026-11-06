/**
 * PROTOTYPE (2026-11-06, operator: "very basic, spacing inefficient, labels and
 * typography chaotic"): the one props bag every Standup layout variant renders
 * from. Data, view model and keyboard controller stay shared in StandupPanel;
 * a variant is presentation only. Deleted at consolidation with the switcher.
 */
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { FixtureChoice } from '../data/fixtureToggle';
import type { StandupSource } from '../data/types';
import type { StandupView } from '../model/types';
import type { useStandupController } from '../useStandupController';

export type StandupController = ReturnType<typeof useStandupController>;

export interface StandupLayoutProps {
  view: StandupView;
  source: StandupSource;
  /** ui (sel, typing, dossier, rules, keys, zoom) + select/pick/typed/set/arm/amend/end. */
  c: StandupController;
  /** DEV fixture switch state (render <FixtureSwitch/> from ../parts/HeaderActions). */
  fixture: FixtureChoice;
  onFixture: (c: FixtureChoice) => void;
  /** The table region is loading its first data. */
  loading: boolean;
  rules: AwayRules | null;
}
