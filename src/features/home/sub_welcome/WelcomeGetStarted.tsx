import { Bot, Sparkles, MessageCircle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * First-run call-to-action band on the Cockpit landing (the Welcome surface shows the same
 * entry as a kit section, GetStartedSection).
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
 *
 * Loading choreography (docs/design/overview-loading.md): while `isLoading`
 * we render nothing rather than a ghost — personas are usually pre-warmed
 * before Home mounts, so this is a rare, near-instant window for a genuinely
 * fresh profile, not a real loading state to ghost. Once resolved, the entry
 * is held invisible for the same 150ms window as a Suspense fallback
 * (`animate-fade-in`, `fill-mode: both`) before its existing fade/slide plays,
 * so a decision that lands within a frame never visibly "pops".
 *
 * `useGetStarted` says whether the entry shows and holds its two actions, shared by the band below
 * and the Welcome surface's kit section (GetStartedSection). Only a genuinely fresh profile, and
 * never during the initial fetch (so it can't flash for a returning user before their personas
 * load).
 */
export function useGetStarted(): { visible: boolean; build: () => void; ask: () => void } {
  const personaCount = useAgentStore((s) => s.personas.length);
  const isLoading = useAgentStore((s) => s.isLoading);
  const startOnboarding = useSystemStore((s) => s.startOnboarding);
  const onboardingCompleted = useSystemStore((s) => s.onboardingCompleted);
  const openCompanion = useAthenaStore((s) => s.setState);
  return {
    visible: !isLoading && personaCount === 0 && !onboardingCompleted,
    build: () => startOnboarding(),
    ask: () => openCompanion('open'),
  };
}

export default function WelcomeGetStarted() {
  const { t } = useTranslation();
  const g = t.home.get_started;
  const { visible, build, ask } = useGetStarted();
  if (!visible) return null;

  return (
    <div
      data-testid="welcome-get-started"
      className="animate-fade-slide-in motion-reduce:animate-none rounded-2xl border border-role-agent/25 bg-gradient-to-br from-role-agent/10 to-primary/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
      style={{ animationDelay: '150ms' }}
    >
      <div className="w-11 h-11 shrink-0 rounded-modal bg-role-agent/15 border border-role-agent/25 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-role-agent" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="typo-heading text-foreground">{g.title}</h2>
        <p className="typo-body text-foreground">{g.subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="primary" size="md" icon={<Bot className="w-4 h-4" />} onClick={build}>
          {g.build_cta}
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<MessageCircle className="w-4 h-4" />}
          onClick={ask}
        >
          {g.ask_cta}
        </Button>
      </div>
    </div>
  );
}
