import { useCallback, useMemo, useState } from 'react';

import { KitHost } from '@/features/shared/components/kit';
import { useFixtureChoice, type FixtureChoice } from './data/fixtureToggle';
import { useFixtureBuilder, useStandupFixture } from './data/useStandupFixture';
import { useStandupLive } from './data/useStandupLive';
import { buildView } from './model/buildView';
import { INITIAL_UI, type UiState } from './model/keymap';
import { AwayRulesSheet } from './parts/AwayRulesSheet';
import { DossierDrawer } from './parts/DossierDrawer';
import { KeyLegend } from './parts/KeyLegend';
import { StandupPage } from './parts/StandupPage';
import { useStandupController } from './useStandupController';
import './standup.css';

/**
 * Athena > Standup (spark app-standup): every project is one line through
 * today (the away log), the decision and tonight (the forecast); the operator
 * decides on the selected row and arms the plan at the go-gate. The page is
 * V1 Ledger's layout in the Console component language (`parts/StandupPage`);
 * the dossier, away rules and key legend are shared overlays on their own layer.
 * Data: live IPC (`src/api/companion/standup.ts`), or in a DEV build the
 * explicit fixture switch.
 */
export default function StandupPanel() {
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

  return (
    <KitHost testId="athena-standup-panel">
      <StandupPage view={view} source={source} c={c} fixture={choice} onFixture={setChoice} loading={loading} rules={rules} />
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
