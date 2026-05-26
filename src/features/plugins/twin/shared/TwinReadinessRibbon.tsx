import { BookOpen, Brain, Mic, Radio, User, Volume2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinTab } from '@/lib/types/types';
import type { LucideIcon } from 'lucide-react';
import type { MilestoneStatus, TwinReadiness } from '../useTwinReadiness';

/**
 * Compact readiness ribbon for the shared TwinHeaderBand: the active twin's
 * score plus six clickable milestone dots that deep-link into each sub-tab.
 * It carries the same readiness context onto every Twin page header (Stage 1
 * wires Identity / Tone / Brain), not just the Profiles roster.
 */

type MilestoneKey = keyof Omit<TwinReadiness, 'score' | 'counts'>;

const MILESTONE_META: { key: MilestoneKey; tab: TwinTab; icon: LucideIcon }[] = [
  { key: 'identity', tab: 'identity', icon: User },
  { key: 'tone', tab: 'tone', icon: Mic },
  { key: 'brain', tab: 'brain', icon: Brain },
  { key: 'voice', tab: 'voice', icon: Volume2 },
  { key: 'channels', tab: 'channels', icon: Radio },
  { key: 'memories', tab: 'knowledge', icon: BookOpen },
];

function dotClass(status: MilestoneStatus): string {
  if (status === 'complete') return 'bg-emerald-500/15 text-emerald-300';
  if (status === 'partial') return 'bg-amber-500/15 text-amber-300';
  return 'bg-secondary/40 text-foreground';
}

export function TwinReadinessRibbon({ readiness, onJump }: { readiness: TwinReadiness; onJump: (tab: TwinTab) => void }) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const statusText = (s: MilestoneStatus) =>
    s === 'complete' ? t.progress.statusComplete : s === 'partial' ? t.progress.statusPartial : t.progress.statusEmpty;
  const scoreColor = readiness.score >= 80 ? 'text-emerald-300' : readiness.score >= 40 ? 'text-amber-300' : 'text-violet-300';

  return (
    <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-primary/15 bg-card/40 backdrop-blur">
      <span className="flex items-baseline gap-1">
        <span className={`typo-data-lg tabular-nums leading-none ${scoreColor}`}>{readiness.score}</span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{t.progress.readiness}</span>
      </span>
      <span className="w-px h-5 bg-primary/15" />
      <div className="flex items-center gap-1">
        {MILESTONE_META.map(({ key, tab, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onJump(tab)}
            title={`${t.progress[key]} — ${statusText(readiness[key])}`}
            aria-label={tx(t.profiles.openSection, { section: t.progress[key] })}
            className={`w-5 h-5 rounded-full inline-flex items-center justify-center focus-ring hover:brightness-125 transition-[filter] ${dotClass(readiness[key])}`}
          >
            <Icon className="w-2.5 h-2.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
