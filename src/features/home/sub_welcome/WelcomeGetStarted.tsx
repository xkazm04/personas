import { Bot, Sparkles, MessageCircle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * First-run call-to-action band on the Welcome hero.
 *
 * Fixes UAT L1 F-ONBOARDING-DEAD-CODE (the 5-step onboarding overlay had no
 * entry point — nothing called startOnboarding(), so a first-timer landed on a
 * bare module grid) and F-WELCOME-FRAMING ("no 'see it work' first action on
 * the welcome screen"), and signposts the assistant (F-COMPANION-DISCOVERABILITY
 * — the orb is on but nothing told the user to talk to it).
 *
 * Shown only for a fresh profile (no personas, onboarding not completed) and
 * never while the initial persona fetch is in flight, so a returning user with
 * personas never sees it. The primary CTA launches the (now-mounted) overlay;
 * the secondary opens the companion chat.
 */
export default function WelcomeGetStarted() {
  const { t } = useTranslation();
  const g = t.home.get_started;
  const personaCount = useAgentStore((s) => s.personas.length);
  const isLoading = useAgentStore((s) => s.isLoading);
  const startOnboarding = useSystemStore((s) => s.startOnboarding);
  const onboardingCompleted = useSystemStore((s) => s.onboardingCompleted);
  const openCompanion = useCompanionStore((s) => s.setState);

  // Only a genuinely fresh profile, and never during the initial fetch (so it
  // can't flash for a returning user before their personas load).
  if (isLoading || personaCount > 0 || onboardingCompleted) return null;

  return (
    <div
      data-testid="welcome-get-started"
      className="animate-fade-slide-in motion-reduce:animate-none rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-cyan-500/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="w-11 h-11 shrink-0 rounded-modal bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="typo-heading text-foreground">{g.title}</h2>
        <p className="typo-body text-foreground">{g.subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="primary" size="md" icon={<Bot className="w-4 h-4" />} onClick={() => startOnboarding()}>
          {g.build_cta}
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<MessageCircle className="w-4 h-4" />}
          onClick={() => openCompanion('open')}
        >
          {g.ask_cta}
        </Button>
      </div>
    </div>
  );
}
