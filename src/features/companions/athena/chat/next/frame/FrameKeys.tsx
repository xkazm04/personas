/**
 * FrameKeys — the top edge's icon-only mode keys, the same set the Current
 * header carries (the autonomy option, dev mode, sleep cycle, reset) plus
 * what the island needs: expand (taller sheet), FOLD (back to the capsule, Esc)
 * and, set apart at the end, HIDE (turns Athena's panel off entirely: a
 * different glyph and words so it never reads as a second fold). Every key names itself through the shared Tooltip and
 * aria-label; the look decides its shape. Autonomy, cadence and boldness sit
 * behind the one option key; reset and the sleep cycle confirm through the
 * shared anchored `ConfirmPopover`; saving the log lives in the dev ledger row.
 */

import type { ComponentType } from 'react';
import { ChevronDown, CodeXml, EyeOff, Maximize2, Minimize2 } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useAthenaStore } from '../../../athenaStore';
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
  shortcut,
}: {
  look: FrameLook;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
  /** Shown beside the name in the tooltip and announced as aria-keyshortcuts. */
  shortcut?: { label: string; aria: string };
}) {
  return (
    <Tooltip content={shortcut ? `${label} · ${shortcut.label}` : label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        aria-keyshortcuts={shortcut?.aria}
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
  onFold,
  foldShortcut,
}: {
  look: FrameLook;
  expanded: boolean;
  onExpand: () => void;
  onFold: () => void;
  foldShortcut: { label: string; aria: string };
}) {
  const { t } = useTranslation();
  const c = t.athena;
  const devMode = useSystemStore((s) => s.athenaDevMode);
  const orbEnabled = useSystemStore((s) => s.athenaOrbEnabled);
  const devAvailable = useAthenaStore((s) => s.devModeAvailable);
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
            icon={CodeXml}
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
        testId="companion-fusion-expand"
      />
      <Key
        look={look}
        icon={ChevronDown}
        label={C.foldConversation}
        shortcut={foldShortcut}
        onClick={onFold}
        testId="companion-fusion-fold"
      />
      <span className="fu-keys-sep" aria-hidden />
      <Key
        look={look}
        icon={EyeOff}
        label={orbEnabled ? C.minimizeAthena : C.hideAthena}
        onClick={() => useAthenaStore.getState().setState(orbEnabled ? 'minimized' : 'collapsed')}
        testId="companion-close"
      />
    </div>
  );
}
