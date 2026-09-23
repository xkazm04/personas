/**
 * FrameKeys — the top edge's icon-only mode keys, the same set the Current
 * header carries (autonomy, cadence, boldness, daily goals, dev mode, save log,
 * sleep cycle, reset, close) plus expand. Every key names itself through the
 * shared Tooltip and aria-label; the look decides its shape.
 */

import { useState, type ComponentType } from 'react';
import {
  Flame,
  Gauge,
  Infinity as InfinityIcon,
  Maximize2,
  Minimize2,
  RotateCcw,
  Timer,
  Wrench,
  X,
} from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { DevConversationLogButton } from '../../../DevConversationLogButton';
import { useCompanionStore } from '../../../companionStore';
import { AthenaChatSleepButton } from '../../AthenaChatSleepButton';
import type { ToolStrip } from '../../AthenaChatHeader';
import { resetConversation, setAutonomousMode, setDevMode } from '../../athenaChatActions';
import { NEXT_COPY as C } from '../nextCopy';
import type { FrameLook } from './frameLook';

function Key({
  look,
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  look: FrameLook;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        data-testid={testId}
        className={`grid place-items-center shrink-0 transition-colors focus-ring ${look.icon.button} ${active ? look.icon.active : ''}`}
      >
        <Icon className={look.icon.size} strokeWidth={look.icon.stroke} />
      </button>
    </Tooltip>
  );
}

export function FrameKeys({
  look,
  strip,
  onStrip,
  expanded,
  onExpand,
}: {
  look: FrameLook;
  strip: ToolStrip | null;
  onStrip: (s: ToolStrip) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const devAvailable = useCompanionStore((s) => s.devModeAvailable);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <Key
        look={look}
        icon={InfinityIcon}
        label={autonomous ? c.autonomous_toggle_off : c.autonomous_toggle_on}
        active={autonomous}
        onClick={() => setAutonomousMode(!autonomous)}
        testId="companion-toggle-autonomous"
      />
      {autonomous && (
        <>
          <Key look={look} icon={Timer} label={c.wake_cadence_label} active={strip === 'cadence'} onClick={() => onStrip('cadence')} />
          <Key look={look} icon={Gauge} label={c.boldness_label} active={strip === 'boldness'} onClick={() => onStrip('boldness')} />
        </>
      )}
      {devAvailable && (
        <>
          <Key look={look} icon={Flame} label={c.daily_goals_label} active={strip === 'goals'} onClick={() => onStrip('goals')} />
          <Key
            look={look}
            icon={Wrench}
            label={devMode ? c.dev_toggle_off : c.dev_toggle_on}
            active={devMode}
            onClick={() => setDevMode(!devMode)}
            testId="companion-toggle-dev-mode"
          />
          <DevConversationLogButton />
          <AthenaChatSleepButton />
        </>
      )}
      <Key look={look} icon={RotateCcw} label={c.reset} onClick={() => setResetOpen(true)} testId="companion-reset" />
      <Key
        look={look}
        icon={expanded ? Minimize2 : Maximize2}
        label={expanded ? C.collapseConversation : C.expandConversation}
        active={expanded}
        onClick={onExpand}
      />
      <Key
        look={look}
        icon={X}
        label={t.common.close}
        onClick={() => useCompanionStore.getState().setState(orbEnabled ? 'minimized' : 'collapsed')}
        testId="companion-close"
      />
      {resetOpen && (
        <ConfirmDialog
          title={c.reset_confirm_title}
          body={c.reset_confirm_body}
          danger
          confirmLabel={c.reset_confirm_action}
          onConfirm={async () => {
            await resetConversation();
            setResetOpen(false);
          }}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </div>
  );
}
