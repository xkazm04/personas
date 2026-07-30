/**
 * Morning Director — the one-click action bar rendered under a briefing
 * widget. Follows the shared action grammar: explicit affordance → one
 * click → confirm when spendy/destructive (rerun, pause) → executes via
 * existing IPC → recorded to the decision ledger.
 *
 * Visual language mirrors the DecisionAction tone system: approve-ish
 * verbs read primary, decline/pause read rose, everything else neutral.
 */
import { useState } from 'react';
import { Check, Pause, Play, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
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
      return <Play className="w-3 h-3" aria-hidden />;
    case 'pause_persona':
      return <Pause className="w-3 h-3" aria-hidden />;
    case 'approve_approval':
      return <Check className="w-3 h-3" aria-hidden />;
    case 'decline_approval':
      return <X className="w-3 h-3" aria-hidden />;
  }
}

/** Tone classes per verb — reads like the shared DecisionAction tones. */
function toneClass(kind: CockpitWidgetAction['kind']): string {
  switch (kind) {
    case 'decline_approval':
    case 'pause_persona':
      return 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-400';
    default:
      return 'bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary';
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
      <button
        type="button"
        data-testid={`briefing-action-${action.kind}`}
        onClick={onClick}
        disabled={state === 'busy' || state === 'done'}
        title={label}
        className={`inline-flex items-center gap-1.5 max-w-full rounded-interactive px-2.5 py-1.5 typo-caption font-medium transition-colors focus-ring border disabled:opacity-60 ${
          state === 'done'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : state === 'failed'
              ? 'bg-status-error/10 border-status-error/20 text-status-error'
              : toneClass(action.kind)
        }`}
      >
        {state === 'done' ? <Check className="w-3 h-3" aria-hidden /> : actionIcon(action.kind)}
        <span className="truncate">{stateLabel}</span>
      </button>
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
 * Renders the enum-validated actions for one widget. Parent passes an
 * already-parsed list (see `parseWidgetActions`); empty list renders
 * nothing, so display-only widgets are untouched.
 */
export function WidgetActionBar({ actions }: { actions: CockpitWidgetAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5 pt-2"
      data-testid="briefing-widget-actions"
    >
      {actions.map((a, i) => (
        <ActionButton
          key={`${a.kind}-${'personaId' in a ? a.personaId : a.approvalId}-${i}`}
          action={a}
        />
      ))}
    </div>
  );
}
