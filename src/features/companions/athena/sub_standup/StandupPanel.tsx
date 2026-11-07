import { useMemo, useState } from 'react';

import { KitHost } from '@/features/shared/components/kit';
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
 * a row's decision opens in a modal, and the dossier, away rules and key legend
 * are overlays on their own layer. Data: live IPC (`src/api/companion/standup.ts`);
 * the fixture under `fixture/` is test data only. "Plan with Athena" hands the
 * interview to her chat (`data/standupChat.ts`).
 */
export default function StandupPanel() {
  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const source = useStandupLive(true, ui.zoom === '12d');
  const view = useMemo(() => buildView(source.input), [source.input]);
  const c = useStandupController(view, source, ui, setUi);
  const row = view.rows[c.ui.sel];
  const rules = source.input.standup?.awayRules ?? null;
  const loading = source.loading.standup;

  return (
    <KitHost testId="athena-standup-panel">
      <StandupPage view={view} source={source} c={c} loading={loading} rules={rules} />
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
