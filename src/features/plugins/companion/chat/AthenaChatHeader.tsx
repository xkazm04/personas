/**
 * AthenaChatHeader — identity badge, thread switcher, and the mode keys.
 *
 * Athena's quick behaviour setup (autonomous mode, cadence, boldness) sits
 * behind ONE option key (`AthenaAutonomyOption`) instead of a row of toggles
 * and accordion strips. Reset asks through the shared anchored confirmation
 * (`AthenaChatResetKey`), the same one the dev sleep-cycle key uses. Saving the
 * conversation log lives in the dev ledger row, not here.
 */

import { Bot, Wrench, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { ConversationSwitcher } from '../ConversationSwitcher';
import { useCompanionStore } from '../companionStore';
import { AthenaAutonomyOption, type HeaderKeyLook } from './AthenaAutonomyOption';
import { AthenaChatResetKey } from './AthenaChatResetKey';
import { AthenaChatSleepButton } from './AthenaChatSleepButton';
import { setDevMode } from './athenaChatActions';

const KEY = 'p-1.5 rounded-interactive';
const PRIMARY_LOOK: HeaderKeyLook = {
  button: `${KEY} text-foreground/70 hover:text-foreground hover:bg-foreground/5`,
  active: 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
  icon: 'w-4 h-4',
};
const NEUTRAL_LOOK: HeaderKeyLook = {
  button: `${KEY} text-foreground hover:bg-foreground/5`,
  active: 'bg-foreground/10',
  icon: 'w-4 h-4',
};

function IconKey({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
  tone = 'neutral',
}: {
  icon: typeof X;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
  /** Amber marks the dev wrench so it can't be confused with the mode keys. */
  tone?: 'amber' | 'neutral';
}) {
  const cls =
    tone === 'amber'
      ? active
        ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/20'
        : 'text-foreground hover:text-amber-400 hover:bg-amber-500/10'
      : 'text-foreground hover:bg-foreground/5';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        aria-pressed={active}
        aria-label={label}
        className={`${KEY} transition-colors focus-ring ${cls}`}
      >
        <Icon className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />;
}

export function AthenaChatHeader() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const devModeAvailable = useCompanionStore((s) => s.devModeAvailable);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);

  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-foreground/10 bg-foreground/[0.02] shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* A small static badge only — the full Athena avatar is the watermark
            behind the chat, so a second video here would be visual noise. */}
        <span
          className={`inline-flex w-7 h-7 items-center justify-center rounded-full bg-primary/15 text-primary transition-shadow ${
            autonomousMode ? 'ring-1 ring-primary/40' : ''
          }`}
          aria-hidden
        >
          <Bot className="w-3.5 h-3.5" />
        </span>
        <ConversationSwitcher />
      </div>
      <div className="flex items-center gap-1">
        <AthenaAutonomyOption look={PRIMARY_LOOK} />
        {devModeAvailable && (
          <>
            <Divider />
            <IconKey
              icon={Wrench}
              label={devMode ? c.dev_toggle_off : c.dev_toggle_on}
              active={devMode}
              tone="amber"
              onClick={() => setDevMode(!devMode)}
              testId="companion-toggle-dev-mode"
            />
            <AthenaChatSleepButton />
          </>
        )}
        <Divider />
        <AthenaChatResetKey look={NEUTRAL_LOOK} />
        <Divider />
        <IconKey
          icon={X}
          label={t.common.close}
          onClick={() =>
            useCompanionStore.getState().setState(orbEnabled ? 'minimized' : 'collapsed')
          }
          testId="companion-close"
          tone="neutral"
        />
      </div>
    </header>
  );
}
