// ReloginControls — the two acts a dead plan's row offers: Re-login, and Open
// sign-in window.
//
// SPINNER ONLY HERE. While a run is in flight the Re-login control is the one
// thing on the row that turns (`Button loading`); the rest of the row stays
// still, under its permanent chrome. The run's progress is the step chip beside
// the name, not an animation.
//
// Open sign-in window is the human's way in: it opens the plan's linked
// browser profile visibly so the operator can finish a sign-in by hand. It is an
// icon (a labelled button would take the room the account name needs on a
// two-cell row) named by its tooltip and aria-label. Without a linked profile
// there is nothing to open, so it is disabled and the tooltip says why.
// Both acts stop the click from reaching the row, whose own click is a switch.

import type { MouseEvent } from 'react';
import { ExternalLink, LogIn } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { PlanModel } from './useResourceModel';
import type { ReloginActs } from './reloginActs';
import type { ReloginView } from './reloginModel';

export function ReloginControls({
  view, plan, email, acts,
}: {
  view: ReloginView;
  plan: PlanModel;
  email: string;
  acts: ReloginActs;
}) {
  const { t, tx } = useTranslation();
  const running = view.kind === 'running';
  const profileKey = plan.login?.profileKey ?? null;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <span className="flex flex-shrink-0 items-center gap-1" data-testid="fleet-usage-relogin-controls" onClick={stop}>
      {view.kind === 'needs_you' && (
        <Tooltip content={profileKey === null ? t.monitor.usage_relogin_no_profile : t.monitor.usage_relogin_open_window_hint}>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={profileKey === null}
            onClick={() => { if (profileKey) void acts.openSignIn(profileKey); }}
            aria-label={tx(t.monitor.usage_relogin_open_window_aria, { email })}
            data-testid="fleet-usage-open-window"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Button>
        </Tooltip>
      )}
      <Button
        size="xs"
        variant="secondary"
        icon={<LogIn className="h-3 w-3" aria-hidden />}
        loading={running}
        disabled={running}
        onClick={() => { void acts.relogin(plan.id); }}
        aria-label={tx(t.monitor.usage_relogin_action_aria, { email })}
        data-testid="fleet-usage-relogin"
      >
        {t.monitor.usage_relogin_action}
      </Button>
    </span>
  );
}

export default ReloginControls;
