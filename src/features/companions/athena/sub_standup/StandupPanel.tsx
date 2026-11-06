import { useCallback, useMemo, useState, type ComponentType } from 'react';

import { KitHost } from '@/features/shared/components/kit';
import { useFixtureChoice, type FixtureChoice } from './data/fixtureToggle';
import { useFixtureBuilder, useStandupFixture } from './data/useStandupFixture';
import { useStandupLive } from './data/useStandupLive';
import { buildView } from './model/buildView';
import { INITIAL_UI, type UiState } from './model/keymap';
import { AwayRulesSheet } from './parts/AwayRulesSheet';
import { DossierDrawer } from './parts/DossierDrawer';
import { KeyLegend } from './parts/KeyLegend';
import { useStandupController } from './useStandupController';
import { ConsoleLayout } from './variants/console/ConsoleLayout';
import { EditorialLayout } from './variants/editorial/EditorialLayout';
import { LedgerLayout } from './variants/ledger/LedgerLayout';
import { StudioLayout } from './variants/studio/StudioLayout';
import type { StandupLayoutProps } from './variants/types';
import { useLayoutVariant, VariantSwitch, type LayoutVariant } from './variants/VariantSwitch';
import './standup.css';

const LAYOUTS: Record<LayoutVariant, ComponentType<StandupLayoutProps>> = {
  ledger: LedgerLayout,
  console: ConsoleLayout,
  editorial: EditorialLayout,
  studio: StudioLayout,
};

/** Hatches the band and the rows reference by id (one definition per page). */
function SvgDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <defs>
        <pattern id="su-run-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="su-hatch-b" width="8" height="8" />
          <rect className="su-hatch-a" width="4" height="8" />
        </pattern>
        <pattern id="su-gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="su-gap-line" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
    </svg>
  );
}

/**
 * Athena > Standup (spark app-standup, WP4): the contest winner B/1
 * "Timetable" on the app's own material. Every project is one line through
 * today (the away log), NOW (the decision) and tonight (the forecast); the
 * operator decides at the NOW column and arms the plan at the go-gate.
 * Data: live IPC (`src/api/companion/standup.ts`), or in a DEV build the
 * explicit fixture switch.
 */
export default function StandupPanel() {
  const [variant, setVariant] = useLayoutVariant();
  const [choice, setChoice] = useFixtureChoice();
  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const fixtureOn = choice !== 'off';
  const live = useStandupLive(!fixtureOn, ui.zoom === '12d');
  const onScenario = useCallback((c: FixtureChoice) => setChoice(c), [setChoice]);
  const fixture = useStandupFixture(useFixtureBuilder(fixtureOn), fixtureOn ? choice : 'decide', onScenario);
  const source = fixtureOn && fixture ? fixture : live;
  const view = useMemo(() => buildView(source.input), [source.input]);
  const c = useStandupController(view, source, ui, setUi);
  const row = view.rows[c.ui.sel];
  const rules = source.input.standup?.awayRules ?? null;
  const loading = fixtureOn ? !fixture : source.loading.standup;

  const Layout = LAYOUTS[variant];

  return (
    <KitHost testId="athena-standup-panel">
      <div className="su-proto" data-variant={variant}>
        <SvgDefs />
        <VariantSwitch value={variant} onChange={setVariant} />
        <Layout view={view} source={source} c={c} fixture={choice} onFixture={setChoice} loading={loading} rules={rules} />
      </div>
      <DossierDrawer row={row} open={c.ui.dossier} onClose={() => c.set({ dossier: false })} />
      {rules && (
        <AwayRulesSheet
          open={c.ui.rules}
          rules={rules}
          editable={view.life === 'decide'}
          projectNames={source.input.projectNames}
          onClose={() => c.set({ rules: false })}
          onChange={(r) => { void source.actions.setRules(r); }}
        />
      )}
      <KeyLegend open={c.ui.keys} onClose={() => c.set({ keys: false })} />
    </KitHost>
  );
}
