import { Brain, HelpCircle, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Thin vertical toolbar on the right side of the panel for quick user
 * actions. Currently:
 *   - Help — drops a "what can you do?" prompt into the conversation
 *   - Brain — opens the Brain Viewer (overlay over the transcript)
 *   - Voice — toggles spoken summaries (only visible when the user has
 *     configured an ElevenLabs credential + voice id under the plugin's
 *     Voice tab; we never show the toggle when the feature is unreachable
 *     so the UI doesn't dangle a button that does nothing). The toggle
 *     defaults to off even when configured — voice is opt-in per session.
 *
 * Layout: 40px wide, flush against the right edge of the panel body,
 * separated from the transcript by a subtle left border. Buttons are
 * 32×32 with the same hover/focus styling as the header buttons so the
 * panel feels visually consistent.
 */
export function CompanionToolbar({
  onAskCapabilities,
  onOpenBrain,
  brainOpen,
  disabled,
}: {
  onAskCapabilities: () => void;
  onOpenBrain: () => void;
  brainOpen: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);
  const voiceConfigured = Boolean(voiceCredentialId && voiceId);

  return (
    <aside
      className="shrink-0 w-10 border-l border-foreground/10 flex flex-col items-center py-3 gap-2 bg-foreground/[0.02]"
      aria-label={t.plugins.companion.toolbar_label}
    >
      <ToolbarButton
        icon={<HelpCircle className="w-4 h-4" />}
        label={t.plugins.companion.help_capabilities}
        onClick={onAskCapabilities}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Brain className="w-4 h-4" />}
        label={t.plugins.companion.brain_open}
        onClick={onOpenBrain}
        active={brainOpen}
      />
      {voiceConfigured && (
        <ToolbarButton
          icon={
            voiceEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )
          }
          label={
            voiceEnabled
              ? t.plugins.companion.voice_disable
              : t.plugins.companion.voice_enable
          }
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          active={voiceEnabled}
        />
      )}
    </aside>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 rounded-interactive inline-flex items-center justify-center transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
      }`}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}
