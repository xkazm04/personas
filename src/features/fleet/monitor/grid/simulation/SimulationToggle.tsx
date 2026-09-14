// SimulationToggle — the golden switch in the Activity header.
//
// It renders ONLY in a build whose test-automation bridge is open
// (`isTestBuild`), so it cannot appear in a shipped installer even if a future
// caller forgets to ask. On, it is a filled gold chip; off, a gold outline —
// the two states have to be tellable apart at a glance and across a screenshot,
// because everything else on the board looks identical either way and the
// difference between them is "these numbers are real" and "these numbers are
// invented".
//
// Gold rather than the primary hue on purpose: `--status-warning` is this app's
// "look at this before you trust it" colour, which is exactly the claim a
// simulation badge makes. It is a token, not an amber class, so it inverts with
// the theme like every other status surface.

import { FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { isTestBuild, toggleSimulation, useSimulationEnabled } from './simulationMode';

export function SimulationToggle() {
  const { t } = useTranslation();
  const enabled = useSimulationEnabled();
  // Read per render rather than once at module load: the init script beats page
  // JS in the app, but a test may install the flag after this module imports.
  if (!isTestBuild()) return null;

  return (
    <Tooltip content={enabled ? t.monitor.grid_simulation_on : t.monitor.grid_simulation_off}>
      <button
        type="button"
        onClick={toggleSimulation}
        aria-pressed={enabled}
        data-testid="fleet-grid-simulation-toggle"
        data-simulating={enabled}
        className={`focus-ring inline-flex flex-shrink-0 items-center gap-1 rounded-interactive border px-2 py-0.5 typo-caption transition-colors ${
          enabled
            ? 'border-status-warning bg-status-warning text-background shadow-elevation-1'
            : 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
        }`}
      >
        <FlaskConical className="h-3 w-3 flex-shrink-0" aria-hidden />
        {t.monitor.grid_simulation}
      </button>
    </Tooltip>
  );
}

export default SimulationToggle;
