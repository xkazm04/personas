import { BarChart3, Bot, Zap, Key, FlaskConical, Settings, Puzzle } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAuthStore } from '@/stores/authStore';
import { useEffect, useMemo } from 'react';
import { useHomeTranslation } from '../i18n/useTranslation';
import { schedulePrefetchOtherHomeTabs } from '../lib/prefetch';
import WelcomeLayout from './WelcomeLayout';

import type { NavCard } from './NavigationGrid';

const NAV_CARDS: NavCard[] = [
  { id: 'overview', icon: BarChart3, color: 'indigo', gradFrom: 'from-indigo-500/8', gradTo: 'to-violet-500/4', glowColor: 'bg-indigo-500/20', accentBorder: 'border-indigo-500/20 hover:border-indigo-400/40', iconBg: 'bg-indigo-500/15', iconText: 'text-indigo-400' },
  { id: 'personas', icon: Bot, color: 'cyan', gradFrom: 'from-cyan-500/8', gradTo: 'to-blue-500/4', glowColor: 'bg-cyan-500/20', accentBorder: 'border-cyan-500/20 hover:border-cyan-400/40', iconBg: 'bg-cyan-500/15', iconText: 'text-cyan-400' },
  { id: 'events', icon: Zap, color: 'amber', gradFrom: 'from-amber-500/8', gradTo: 'to-orange-500/4', glowColor: 'bg-amber-500/20', accentBorder: 'border-amber-500/20 hover:border-amber-400/40', iconBg: 'bg-amber-500/15', iconText: 'text-amber-400' },
  { id: 'credentials', icon: Key, color: 'emerald', gradFrom: 'from-emerald-500/8', gradTo: 'to-teal-500/4', glowColor: 'bg-emerald-500/20', accentBorder: 'border-emerald-500/20 hover:border-emerald-400/40', iconBg: 'bg-emerald-500/15', iconText: 'text-emerald-400' },
  { id: 'design-reviews', icon: FlaskConical, color: 'purple', gradFrom: 'from-purple-500/8', gradTo: 'to-fuchsia-500/4', glowColor: 'bg-purple-500/20', accentBorder: 'border-purple-500/20 hover:border-purple-400/40', iconBg: 'bg-purple-500/15', iconText: 'text-purple-400' },
  { id: 'plugins', icon: Puzzle, color: 'violet', gradFrom: 'from-violet-500/8', gradTo: 'to-purple-500/4', glowColor: 'bg-violet-500/20', accentBorder: 'border-violet-500/20 hover:border-violet-400/40', iconBg: 'bg-violet-500/15', iconText: 'text-violet-400' },
  { id: 'settings', icon: Settings, color: 'slate', gradFrom: 'from-slate-400/8', gradTo: 'to-zinc-500/4', glowColor: 'bg-slate-400/15', accentBorder: 'border-slate-400/20 hover:border-slate-300/40', iconBg: 'bg-slate-400/15', iconText: 'text-slate-400' },
];


export default function HomeWelcome() {
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const user = useAuthStore((s) => s.user);
  const { t } = useHomeTranslation();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.greeting_morning;
    if (hour < 18) return t.greeting_afternoon;
    return t.greeting_evening;
  }, [t]);

  const displayName = user?.display_name || user?.email?.split('@')[0] || t.operator;

  useEffect(() => schedulePrefetchOtherHomeTabs(), []);

  return (
    <WelcomeLayout
      greeting={greeting}
      displayName={displayName}
      quickNavLabel={t.quick_navigation}
      navCards={NAV_CARDS}
      navTranslations={t.nav}
      onCardClick={(id) => setSidebarSection(id as import('@/lib/types/types').SidebarSection)}
    />
  );
}
