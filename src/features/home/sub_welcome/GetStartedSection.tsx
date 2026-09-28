import { Bot, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { KitButton, Section, Toolbar } from '@/features/shared/components/kit';
import { useGetStarted } from './WelcomeGetStarted';

/**
 * The first-run entry on the Welcome surface: a kit Section whose next steps are one action line
 * on the reading line: building the first agent is the surface's one call to action (a primary
 * KitButton), asking the assistant the second (a default one), as the Cockpit band ranks them.
 * Renders nothing for a returning profile (see useGetStarted). Must sit inside a kit surface
 * (WelcomeLayout's KitHost).
 */
export default function GetStartedSection() {
  const { t } = useTranslation();
  const g = t.home.get_started;
  const { visible, build, ask } = useGetStarted();
  if (!visible) return null;
  return (
    <div data-testid="welcome-get-started" className="contents">
      <Section title={t.home.welcome_layout.get_started} desc={g.subtitle}>
        <Toolbar label={t.home.welcome_layout.get_started}>
          <KitButton tone="primary" icon={<Bot />} onClick={build}>{g.build_cta}</KitButton>
          <KitButton icon={<MessageCircle />} onClick={ask}>{g.ask_cta}</KitButton>
        </Toolbar>
      </Section>
    </div>
  );
}
