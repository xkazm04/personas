// The mandate page's title row, a bay nameplate at page size: the project's
// colour edge, the steward's face, the mandate's title and its state as a
// command-bar chip (lamp and word), one caption line under it, and the one
// door that acts on the whole mandate at the right. A mandate mirrored from
// its home device (WP9) adds a second window, "On <device>": its doors still
// act, and what they decide is sent home.
//
// Suspend is calm at rest and ARMS on the first press (annunciator grammar:
// red is a state the operator put it in, never paint on a quiet page). The
// second press, or S again, suspends; Escape stands it down. Resume needs no
// arming: it gives the steward back what the operator took.

import { Pause, Play } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Kbd, Lamp } from '../parts';
import { statusLabel } from './mandateCopy';
import { MirrorChip } from './MirrorMark';
import { ProjectEdge, StewardFace } from './rowParts';
import { stewardLamp } from './StewardRow';

/** The suspend door's two presses: arm, then act. Resume acts at once. */
export function useSuspendArm(suspended: boolean, act: () => Promise<void>) {
  const [armed, setArmed] = useState(false);
  const press = useCallback(async () => {
    if (suspended || armed) {
      setArmed(false);
      await act();
      return;
    }
    setArmed(true);
  }, [suspended, armed, act]);
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || !armed) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    setArmed(false);
    return true;
  }, { priority: OVERLAY_DISMISS_PRIORITY + 2, enabled: armed });
  return { armed, press, disarm: useCallback(() => setArmed(false), []) };
}

export function MandateHead({ mandate, armed, onSuspend }: {
  mandate: MandateSummary;
  armed: boolean;
  onSuspend: () => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const lamp = stewardLamp(mandate);
  const suspended = mandate.status === 'suspended';
  const steward = mandate.stewardName ?? m.ml_steward_unknown;

  return (
    <header className="flex items-center gap-3 border-b border-foreground/10 pb-3" data-testid="mandate-head">
      <ProjectEdge projectId={mandate.projectId} tall />
      <StewardFace personaId={mandate.stewardPersonaId} name={steward} withName={false} large />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="min-w-0 truncate typo-heading-lg text-foreground">{mandate.title}</h3>
          <span
            className={`ae-win inline-flex flex-shrink-0 items-center gap-2 rounded-input px-2.5 py-0.5 ${lamp.lit ? `is-lit ae-t-${lamp.tone}` : ''}`}
            data-testid="mandate-state"
          >
            <Lamp lamp={lamp} />
            <span className="typo-caption text-foreground">{statusLabel(m, mandate.status)}</span>
          </span>
          <MirrorChip mirror={mandate.mirror} />
        </div>
        <p className="truncate typo-caption">
          {[mandate.projectName ?? m.ml_project_unknown, tx(m.ml_mandate_context, { steward, rung: mandate.scopeRung })].join(' · ')}
        </p>
      </div>
      <AsyncButton
        variant={armed ? 'accent' : 'secondary'}
        tone={armed ? 'error' : undefined}
        size="sm"
        onClick={onSuspend}
        icon={suspended ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
        iconRight={<span className="ml-1.5 inline-flex"><Kbd>S</Kbd></span>}
        aria-keyshortcuts="S"
        data-armed={armed || undefined}
        data-testid="mandate-suspend"
      >
        {suspended ? m.ml_resume : armed ? m.ml_suspend_confirm : m.ml_suspend}
      </AsyncButton>
    </header>
  );
}
