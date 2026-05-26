import { BookOpen, Brain, CheckCircle2, ChevronRight, Mic, Radio, User, Volume2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { buildGaps } from '../shared/readinessGaps';
import type { TwinTab } from '@/lib/types/types';
import type { LucideIcon } from 'lucide-react';
import type { TwinReadiness } from '../useTwinReadiness';

/**
 * Always-visible setup checklist for the active twin (Stage 1 of 2).
 *
 * Promotes the ReadinessGapPopover's triage list into a persistent rail card:
 * all six milestones are shown in foundation order with a completion check,
 * an inline hint for the incomplete ones, and a deep-link into the sub-tab —
 * so the user never has to open the popover to see "what's left". Stage 2
 * will add a roster-wide summary above the per-twin list. Gap copy + the gap
 * ranking are reused from shared/readinessGaps so all readiness surfaces agree.
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

export function CompleteTwinChecklist({ readiness, onJump }: { readiness: TwinReadiness; onJump: (tab: TwinTab) => void }) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const gaps = buildGaps(readiness);
  const gapById = new Map(gaps.map((g) => [g.id, g]));
  const done = MILESTONE_META.filter((m) => readiness[m.key] === 'complete').length;
  const allSet = done === MILESTONE_META.length;

  return (
    <div className="rounded-card border border-primary/10 bg-card/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-foreground font-medium">{t.profiles.checklistHeading}</p>
        <span className="typo-caption tabular-nums text-foreground">{done}/{MILESTONE_META.length}</span>
      </div>

      {allSet ? (
        <div className="flex flex-col items-center text-center gap-1.5 py-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          <p className="typo-caption text-foreground">{t.gaps.allSetBody}</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {MILESTONE_META.map(({ key, tab, icon: Icon }) => {
            const status = readiness[key];
            const complete = status === 'complete';
            const gap = gapById.get(key);
            const detail = complete
              ? t.progress.statusComplete
              : gap
                ? (gap.hintVars ? tx(t.gaps.hints[gap.hintKey], gap.hintVars) : t.gaps.hints[gap.hintKey])
                : t.progress.statusPartial;
            const dot = complete
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : status === 'partial'
                ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                : 'text-rose-300 bg-rose-500/10 border-rose-500/25';
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onJump(tab)}
                  aria-label={tx(t.profiles.openSection, { section: t.progress[key] })}
                  className="group w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-interactive hover:bg-secondary/40 focus-ring transition-colors text-left"
                >
                  <span className={`flex-shrink-0 w-6 h-6 rounded-interactive border flex items-center justify-center ${dot}`}>
                    {complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block typo-caption text-foreground font-medium truncate">{t.progress[key]}</span>
                    <span className="block text-[11px] text-foreground leading-snug truncate">{detail}</span>
                  </span>
                  {!complete && (
                    <ChevronRight className="w-3.5 h-3.5 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
