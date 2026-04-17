import { useState } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronRight, X, Sparkles } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useOnboardingChecklist } from './useOnboardingChecklist';
import { useTranslation } from '@/i18n/useTranslation';

// -- Progress Ring (SVG) ----------------------------------------------

interface ProgressRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({ score, size = 24, strokeWidth = 2.5 }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score === 100 ? '#34d399' : score >= 50 ? '#a78bfa' : '#fbbf24';

  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-primary/10"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
    </svg>
  );
}

// -- Sidebar Score Ring ----------------------------------------------

export function SidebarScoreRing({ score }: { score: number }) {
  if (score >= 100) return null;
  return (
    <div className="relative flex-shrink-0" title={`${score}% setup complete`}>
      <ProgressRing score={score} size={18} strokeWidth={2} />
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-foreground rotate-90">
        {score}
      </span>
    </div>
  );
}

// -- Editor Banner ---------------------------------------------------

const DISMISSED_KEY = 'onboarding-dismissed';

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function setDismissed(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

export function OnboardingBanner({ personaId }: { personaId: string }) {
  const { t, tx } = useTranslation();
  const checklist = useOnboardingChecklist(personaId);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const [dismissed, setDismissedState] = useState(() => getDismissed().has(personaId));
  const [expanded, setExpanded] = useState(false);

  if (dismissed || checklist.allDone || checklist.total === 0) return null;

  const handleDismiss = () => {
    const next = getDismissed();
    next.add(personaId);
    setDismissed(next);
    setDismissedState(true);
  };

  const handleItemClick = (tab?: string) => {
    if (tab) setEditorTab(tab as Parameters<typeof setEditorTab>[0]);
  };

  return (
    <div className="mx-4 mb-3 rounded-modal border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <ProgressRing score={checklist.score} size={28} strokeWidth={3} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-sm font-semibold text-foreground/90">
              {tx(t.agents.onboarding.setup_complete, { score: checklist.score })}
            </span>
          </div>
          <span className="text-sm text-foreground">
            {tx(t.agents.onboarding.steps_done, { completed: checklist.completed, total: checklist.total })}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded-card hover:bg-primary/10 text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-card hover:bg-primary/10 text-foreground transition-colors"
          title={t.agents.onboarding.dismiss_checklist}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="border-t border-violet-500/10 px-3 py-2 space-y-1">
          {checklist.items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleItemClick(item.tab)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded-card text-left transition-colors ${
                item.done
                  ? 'text-foreground'
                  : 'text-foreground hover:bg-violet-500/10'
              }`}
            >
              {item.done ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
              )}
              <span className={`text-sm flex-1 ${item.done ? 'line-through' : ''}`}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
