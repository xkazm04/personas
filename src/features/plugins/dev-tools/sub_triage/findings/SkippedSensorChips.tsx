/**
 * "Wire this" chips for the sensors the last sweep could not read.
 *
 * `describeSweep` and SweepButton both append `skipped: llm, sentry, passport`
 * to a toast and leave it there. A first sweep on a fresh project skips almost
 * everything, raises nothing, and the operator is shown a success-coloured
 * message with a comma-separated list of words - which teaches nothing and
 * reads like a clean bill of health.
 *
 * Each skipped sensor is a chip. A chip whose destination this surface can name
 * is a button that goes there; one whose destination it cannot is still shown,
 * as a label, because the sensor not running is the fact worth surfacing and a
 * chip that navigated somewhere plausible-but-wrong would be worse than none.
 * That split is deliberate and the reason `SKIPPED_SENSOR_TABS` maps to `null`
 * rather than omitting a key.
 */

import { Plug } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevToolsTab } from '@/lib/types/types';
import Button from '@/features/shared/components/buttons/Button';
import { TONE_TEXT } from '../triageTones';

/**
 * Where to go to wire each sensor, or `null` when this surface cannot name a
 * destination honestly.
 *
 *  - `llm`      the tracing connector is assigned on LLM Overview's matrix.
 *  - `sentry`   the monitoring connector is assigned on Dev Tools Overview -
 *               the same destination the ledger's error chip already uses.
 *  - `skills`   usage telemetry is mined and displayed under Skills.
 *  - `docs`     doc-rot needs a workspace scan; the entry point is not a single
 *               Dev Tools tab, so no jump is offered rather than a guessed one.
 *  - `passport` lives in Factory, behind a section + tab handoff this surface
 *               has no producer for. Same reasoning.
 *  - `memory`   likewise.
 */
export const SKIPPED_SENSOR_TABS: Record<string, DevToolsTab | null> = {
  llm: 'llm-overview',
  sentry: 'overview',
  skills: 'skills',
  docs: null,
  passport: null,
  memory: null,
};

/** The i18n key under `plugins.dev_triage` naming each sensor. */
const SENSOR_LABEL_KEY: Record<string, 'sensor_llm' | 'sensor_sentry' | 'sensor_skills' | 'sensor_docs' | 'sensor_passport' | 'sensor_memory'> = {
  llm: 'sensor_llm',
  sentry: 'sensor_sentry',
  skills: 'sensor_skills',
  docs: 'sensor_docs',
  passport: 'sensor_passport',
  memory: 'sensor_memory',
};

export function SkippedSensorChips({ skipped }: { skipped: string[] }) {
  const { t, tx } = useTranslation();
  const dtri = t.plugins.dev_triage;
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  if (skipped.length === 0) return null;

  return (
    <div
      className="px-4 py-2 flex flex-wrap items-center gap-1.5 border-b border-primary/10"
      data-testid="skipped-sensor-chips"
    >
      <Plug className={`w-3 h-3 shrink-0 ${TONE_TEXT.warning}`} aria-hidden />
      <span className="typo-caption text-foreground mr-1">{dtri.sensors_skipped_heading}</span>
      {skipped.map((key) => {
        const labelKey = SENSOR_LABEL_KEY[key];
        const name = labelKey ? dtri[labelKey] : key;
        const tab = SKIPPED_SENSOR_TABS[key] ?? null;
        // A sensor that did not run is a warning (the sweep is thinner than it
        // looks); one this surface can wire is an action in that same tone.
        return tab ? (
          <Button
            key={key}
            variant="accent"
            tone="warning"
            size="xs"
            onClick={() => setDevToolsTab(tab)}
            data-testid={`skipped-sensor-wire-${key}`}
            className="typo-caption"
          >
            {tx(dtri.sensors_skipped_wire, { sensor: name })}
          </Button>
        ) : (
          <span
            key={key}
            data-testid={`skipped-sensor-${key}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive border typo-caption border-primary/15 bg-secondary/20 text-foreground"
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

export default SkippedSensorChips;
