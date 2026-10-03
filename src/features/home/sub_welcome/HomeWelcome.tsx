import { BarChart3, Bot, Zap, Key, FlaskConical, Settings, Puzzle, Users } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import WelcomeLayout from './WelcomeLayout';
import { useNavCardStatus } from './lib/useNavCardStatus';

import type { NavCard } from './NavigationGrid';

// Each module's illustration is coloured by what the module is, not by a palette step: the
// agent role for agents and teams, the external role for connections and plugins, the theme's
// primary for the app's own surfaces.
const NAV_CARDS: NavCard[] = [
  { id: 'overview', icon: BarChart3, tone: 'primary' },
  { id: 'teams', icon: Users, tone: 'agent' },
  { id: 'personas', icon: Bot, tone: 'agent' },
  { id: 'events', icon: Zap, tone: 'primary' },
  { id: 'credentials', icon: Key, tone: 'external' },
  { id: 'design-reviews', icon: FlaskConical, tone: 'primary' },
  { id: 'plugins', icon: Puzzle, tone: 'external' },
  { id: 'settings', icon: Settings, tone: 'neutral' },
];


export default function HomeWelcome() {
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const { t: globalT } = useTranslation();
  const t = globalT.home;

  // Re-evaluate the time-of-day greeting as time passes. Computing it only on
  // mount meant a home view left open across noon / 6pm kept a stale
  // "Good morning". Recompute on a 5-minute tick and whenever the window
  // regains visibility (e.g. the user returns after lunch).
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const sync = () => setHour(new Date().getHours());
    const id = setInterval(sync, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const greeting = useMemo(() => {
    if (hour < 12) return t.greeting_morning;
    if (hour < 18) return t.greeting_afternoon;
    return t.greeting_evening;
  }, [t, hour]);

  // The user is always addressed as "Commander" on the Welcome hero — an
  // Athena-themed honorific — rather than by account name. The time-of-day
  // prefix above stays dynamic (Good Morning / Afternoon / Evening).
  const displayName = t.commander;

  const navStatus = useNavCardStatus();

  return (
    <WelcomeLayout
      greeting={greeting}
      displayName={displayName}
      quickNavLabel={t.quick_navigation}
      navCards={NAV_CARDS}
      navTranslations={t.nav}
      navStatus={navStatus}
      onCardClick={(id) => setSidebarSection(id as import('@/lib/types/types').SidebarSection)}
    />
  );
}
