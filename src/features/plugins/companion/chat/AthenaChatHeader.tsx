/**
 * AthenaChatHeader — identity badge, thread switcher, and the mode toggles.
 *
 * The three tool strips (autonomy cadence / fleet boldness / daily goals) are
 * an ACCORDION on purpose: as always-on stacked rows they read as three
 * competing headers and buried the conversation, so they collapse to icons and
 * at most one row shows at a time.
 */

import { Bot, Flame, Gauge, Infinity as InfinityIcon, RotateCcw, Timer, Wrench, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { ConversationSwitcher } from '../ConversationSwitcher';
import { DevConversationLogButton } from '../DevConversationLogButton';
import { useCompanionStore } from '../companionStore';
import { AthenaChatSleepButton } from './AthenaChatSleepButton';
import { resetConversation, setAutonomousMode, setDevMode } from './athenaChatActions';

export type ToolStrip = 'cadence' | 'boldness' | 'goals';

function IconToggle({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
  tone = 'primary',
  expanded,
}: {
  icon: typeof Timer;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
  /** Amber marks the dev wrench so it can't be confused with the mode toggles. */
  tone?: 'primary' | 'amber' | 'neutral';
  expanded?: boolean;
}) {
  const activeClass =
    tone === 'amber'
      ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/20'
      : 'bg-primary/15 text-primary hover:bg-primary/20';
  const idleClass =
    tone === 'amber'
      ? // Amber hover even when OFF — distinguishes the wrench from the
        // visually identical infinity toggle next to it.
        'text-foreground hover:text-amber-400 hover:bg-amber-500/10'
      : tone === 'neutral'
        ? 'text-foreground hover:bg-foreground/5'
        : 'text-foreground/70 hover:text-foreground hover:bg-foreground/5';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-interactive transition-colors focus-ring ${
        active ? activeClass : idleClass
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />;
}

export function AthenaChatHeader({
  expandedStrip,
  onToggleStrip,
}: {
  expandedStrip: ToolStrip | null;
  onToggleStrip: (strip: ToolStrip) => void;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const devModeAvailable = useCompanionStore((s) => s.devModeAvailable);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);

  // Cadence / boldness ride autonomous mode (their strips are meaningless
  // without it); goals ride dev builds — the same gates the old rows had.
  const strips: Array<{ id: ToolStrip; icon: typeof Timer; label: string; show: boolean }> = [
    { id: 'cadence', icon: Timer, label: c.wake_cadence_label, show: autonomousMode },
    { id: 'boldness', icon: Gauge, label: c.boldness_label, show: autonomousMode },
    { id: 'goals', icon: Flame, label: c.daily_goals_label, show: devModeAvailable },
  ];
  const anyStrip = strips.some((s) => s.show);

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
        <IconToggle
          icon={InfinityIcon}
          label={autonomousMode ? c.autonomous_toggle_off : c.autonomous_toggle_on}
          active={autonomousMode}
          onClick={() => setAutonomousMode(!autonomousMode)}
          testId="companion-toggle-autonomous"
        />
        {strips.map(({ id, icon, label, show }) =>
          show ? (
            <IconToggle
              key={id}
              icon={icon}
              label={label}
              active={expandedStrip === id}
              expanded={expandedStrip === id}
              onClick={() => onToggleStrip(id)}
              testId={`companion-strip-${id}`}
            />
          ) : null,
        )}
        {anyStrip && <Divider />}
        {devModeAvailable && (
          <IconToggle
            icon={Wrench}
            label={devMode ? c.dev_toggle_off : c.dev_toggle_on}
            active={devMode}
            tone="amber"
            onClick={() => setDevMode(!devMode)}
            testId="companion-toggle-dev-mode"
          />
        )}
        {devModeAvailable && <DevConversationLogButton />}
        {devModeAvailable && <AthenaChatSleepButton />}
        <Divider />
        <IconToggle
          icon={RotateCcw}
          label={c.reset}
          onClick={() => void resetConversation()}
          testId="companion-reset"
          tone="neutral"
        />
        <Divider />
        <IconToggle
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
