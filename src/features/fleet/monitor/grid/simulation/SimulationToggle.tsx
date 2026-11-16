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
import Button from '@/features/shared/components/buttons/Button';

export function SimulationToggle() {
  const { t } = useTranslation();
  const enabled = useSimulationEnabled();
  // Read per render rather than once at module load: the init script beats page
  // JS in the app, but a test may install the flag after this module imports.
  if (!isTestBuild()) return null;

  return (
    <Tooltip content={enabled ? t.monitor.grid_simulation_on : t.monitor.grid_simulation_off}>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={toggleSimulation}
        data-testid="fleet-grid-simulation-toggle"
        data-simulating={enabled}
        aria-label={t.monitor.grid_simulation}
        pressed={enabled}
      >
        <FlaskConical className="h-3 w-3 flex-shrink-0" aria-hidden />
      </Button>
    </Tooltip>
  );
}

export default SimulationToggle;
