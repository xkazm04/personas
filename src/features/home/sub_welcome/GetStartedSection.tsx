import { Bot, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContextCard, ContextCards, Section } from '@/features/shared/components/kit';
import { useGetStarted } from './WelcomeGetStarted';

/**
 * The first-run entry on the Welcome surface: a kit Section whose two next steps are cards (the
 * card is the door): build the first agent through the onboarding overlay, or ask the assistant.
 * Waiting on you reads info; the assistant is an agent. Renders nothing for a returning profile
 * (see useGetStarted). Must sit inside a kit surface (WelcomeLayout's KitHost).
 */
export default function GetStartedSection() {
  const { t } = useTranslation();
  const g = t.home.get_started;
  const { visible, build, ask } = useGetStarted();
  if (!visible) return null;
  return (
    <div data-testid="welcome-get-started" className="contents">
      <Section title={t.home.welcome_layout.get_started} desc={g.subtitle}>
        <ContextCards label={t.home.welcome_layout.get_started} min="min(100%, 20rem)">
          <ContextCard
            title={g.build_cta}
            mark={{ tone: 'info', glyph: 'hollow', label: g.build_cta }}
            onPress={build}
            figures={<Bot className="ml-auto -mb-1 w-10 h-10 k-toned t-info" strokeWidth={1.25} aria-hidden />}
          />
          <ContextCard
            title={g.ask_cta}
            mark={{ tone: 'agent', glyph: 'soft', label: g.ask_cta }}
            onPress={ask}
            figures={<MessageCircle className="ml-auto -mb-1 w-10 h-10 k-toned t-agent" strokeWidth={1.25} aria-hidden />}
          />
        </ContextCards>
      </Section>
    </div>
  );
}
