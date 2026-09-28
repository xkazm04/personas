/**
 * Morning Director: the one-click actions of a briefing widget, rendered in
 * the widget Tile's footer (the host hands this bar to the widget as its
 * `footer`, so the actions sit inside the tile they act on). Follows the
 * shared action grammar: explicit affordance, one click, confirm when
 * spendy/destructive (rerun, pause), executes via existing IPC, recorded to
 * the decision ledger.
 *
 * Kit buttons: approving a proposal is the tile's one call to action
 * (`tone="primary"`); the rest are default. A press shows the kit's real busy
 * spinner; the destructive meaning of pause and decline lives in their
 * confirm dialog, not in a hue.
 */
import { useState } from 'react';
import { Check, Pause, Play, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { KitButton } from '@/features/shared/components/kit';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { silentCatch } from '@/lib/silentCatch';

import {
  actionNeedsConfirm,
  runWidgetAction,
  type CockpitWidgetAction,
} from './actions';

type ActionState = 'idle' | 'busy' | 'done' | 'failed';

function defaultLabel(
  kind: CockpitWidgetAction['kind'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (kind) {
    case 'rerun_persona':
      return t.overview.cockpit.action_rerun;
    case 'pause_persona':
      return t.overview.cockpit.action_pause;
    case 'approve_approval':
      return t.overview.cockpit.action_approve;
    case 'decline_approval':
      return t.overview.cockpit.action_decline;
  }
}

function actionIcon(kind: CockpitWidgetAction['kind']) {
  switch (kind) {
    case 'rerun_persona':
      return <Play />;
    case 'pause_persona':
      return <Pause />;
    case 'approve_approval':
      return <Check />;
    case 'decline_approval':
      return <X />;
  }
}

function ActionButton({ action }: { action: CockpitWidgetAction }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ActionState>('idle');
  const [confirming, setConfirming] = useState(false);

  const label = action.label ?? defaultLabel(action.kind, t);

  const execute = async () => {
    setState('busy');
    try {
      await runWidgetAction(action, label);
      setState('done');
    } catch (err) {
      silentCatch('briefing_widget_action')(err);
      setState('failed');
    }
  };

  const onClick = () => {
    if (state === 'busy' || state === 'done') return;
    if (actionNeedsConfirm(action.kind)) {
      setConfirming(true);
    } else {
      void execute();
    }
  };

  const stateLabel =
    state === 'done'
      ? t.overview.cockpit.action_done
      : state === 'failed'
        ? t.overview.cockpit.action_failed
        : label;

  const confirmCopy =
    action.kind === 'rerun_persona'
      ? {
          title: t.overview.cockpit.action_confirm_rerun_title,
          body: t.overview.cockpit.action_confirm_rerun_body,
          danger: false,
        }
      : {
          title: t.overview.cockpit.action_confirm_pause_title,
          body: t.overview.cockpit.action_confirm_pause_body,
          danger: true,
        };

  return (
    <>
      <KitButton
        testId={`briefing-action-${action.kind}`}
        onClick={onClick}
        tone={action.kind === 'approve_approval' && state !== 'done' ? 'primary' : 'default'}
        icon={state === 'done' ? <Check /> : actionIcon(action.kind)}
        loading={state === 'busy'}
        disabled={state === 'done'}
      >
        <span className={state === 'failed' ? 'text-status-error' : undefined}>{stateLabel}</span>
      </KitButton>
      {confirming && (
        <ConfirmDialog
          title={confirmCopy.title}
          body={confirmCopy.body}
          danger={confirmCopy.danger}
          onConfirm={async () => {
            setConfirming(false);
            await execute();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/**
 * Renders the enum-validated actions for one widget, as the content of its
 * Tile footer. Parent passes an already-parsed list (see `parseWidgetActions`);
 * an empty list renders nothing, so display-only widgets are untouched.
 */
export function WidgetActionBar({ actions }: { actions: CockpitWidgetAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="briefing-widget-actions">
      {actions.map((a, i) => (
        <ActionButton
          key={`${a.kind}-${'personaId' in a ? a.personaId : a.approvalId}-${i}`}
          action={a}
        />
      ))}
    </div>
  );
}
