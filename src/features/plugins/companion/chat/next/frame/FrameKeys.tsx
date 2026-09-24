/**
 * FrameKeys — the top edge's icon-only mode keys, the same set the Current
 * header carries (the autonomy option, dev mode, sleep cycle, reset, close)
 * plus expand. Every key names itself through the shared Tooltip and
 * aria-label; the look decides its shape. Autonomy, cadence and boldness sit
 * behind the one option key; reset and the sleep cycle confirm through the
 * shared anchored `ConfirmPopover`; saving the log lives in the dev ledger row.
 */

import type { ComponentType } from 'react';
import { Maximize2, Minimize2, Wrench, X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../../../companionStore';
import { AthenaAutonomyOption, type HeaderKeyLook } from '../../AthenaAutonomyOption';
import { AthenaChatResetKey } from '../../AthenaChatResetKey';
import { AthenaChatSleepButton } from '../../AthenaChatSleepButton';
import { setDevMode } from '../../athenaChatActions';
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
  expanded,
  onExpand,
}: {
  look: FrameLook;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const devMode = useSystemStore((s) => s.companionDevMode);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const devAvailable = useCompanionStore((s) => s.devModeAvailable);
  const keyLook: HeaderKeyLook = {
    button: look.icon.button,
    active: look.icon.active,
    icon: look.icon.size,
    stroke: look.icon.stroke,
  };

  return (
    <div className="flex items-center gap-1.5">
      <AthenaAutonomyOption look={keyLook} />
      {devAvailable && (
        <>
          <Key
            look={look}
            icon={Wrench}
            label={devMode ? c.dev_toggle_off : c.dev_toggle_on}
            active={devMode}
            onClick={() => setDevMode(!devMode)}
            testId="companion-toggle-dev-mode"
          />
          <AthenaChatSleepButton className={look.icon.button} activeClassName={look.icon.active} iconClassName={look.icon.size} />
        </>
      )}
      <AthenaChatResetKey look={keyLook} />
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
    </div>
  );
}
