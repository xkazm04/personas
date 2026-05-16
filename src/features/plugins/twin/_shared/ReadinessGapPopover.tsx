import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Brain, CheckCircle2, Mic, Radio, User, Volume2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinTab } from '@/lib/types/types';
import type { LucideIcon } from 'lucide-react';
import type { MilestoneStatus, TwinReadiness } from '../useTwinReadiness';

/**
 * Readiness popover. Replaces the static "{pct}% ready" badge with a clickable
 * trigger that opens a list of the highest-impact gaps for the active twin
 * and deep-links the user into the matching sub-tab.
 *
 * Each gap is derived purely from the existing TwinReadiness shape — no new
 * data fetches. Empty milestones (severity 1) rank above partial milestones
 * (severity 0); ties broken by a stable priority that favours foundations
 * (identity → tone → brain → voice → channels → memories).
 */

type Severity = 1 | 0;

interface Gap {
  id: keyof Omit<TwinReadiness, 'score' | 'counts'>;
  severity: Severity;
  priority: number;
  tab: TwinTab;
  icon: LucideIcon;
  titleKey: GapTitleKey;
  hintKey: GapHintKey;
  hintVars?: Record<string, string | number>;
}

type GapTitleKey =
  | 'identityEmpty' | 'identityPartial'
  | 'toneEmpty' | 'tonePartial'
  | 'brainEmpty' | 'brainPartial'
  | 'voiceEmpty'
  | 'channelsEmpty' | 'channelsPartial'
  | 'memoriesEmpty' | 'memoriesPartial';

type GapHintKey = GapTitleKey;

const MEMORY_STRONG_THRESHOLD = 5;

function buildGaps(r: TwinReadiness): Gap[] {
  const out: Gap[] = [];

  if (r.identity !== 'complete') {
    out.push({
      id: 'identity',
      severity: r.identity === 'empty' ? 1 : 0,
      priority: 1,
      tab: 'identity',
      icon: User,
      titleKey: r.identity === 'empty' ? 'identityEmpty' : 'identityPartial',
      hintKey: r.identity === 'empty' ? 'identityEmpty' : 'identityPartial',
    });
  }
  if (r.tone !== 'complete') {
    out.push({
      id: 'tone',
      severity: r.tone === 'empty' ? 1 : 0,
      priority: 2,
      tab: 'tone',
      icon: Mic,
      titleKey: r.tone === 'empty' ? 'toneEmpty' : 'tonePartial',
      hintKey: r.tone === 'empty' ? 'toneEmpty' : 'tonePartial',
    });
  }
  if (r.brain !== 'complete') {
    out.push({
      id: 'brain',
      severity: r.brain === 'empty' ? 1 : 0,
      priority: 3,
      tab: 'brain',
      icon: Brain,
      titleKey: r.brain === 'empty' ? 'brainEmpty' : 'brainPartial',
      hintKey: r.brain === 'empty' ? 'brainEmpty' : 'brainPartial',
    });
  }
  if (r.voice !== 'complete') {
    out.push({
      id: 'voice',
      severity: 1,
      priority: 4,
      tab: 'voice',
      icon: Volume2,
      titleKey: 'voiceEmpty',
      hintKey: 'voiceEmpty',
    });
  }
  if (r.channels !== 'complete') {
    out.push({
      id: 'channels',
      severity: r.channels === 'empty' ? 1 : 0,
      priority: 5,
      tab: 'channels',
      icon: Radio,
      titleKey: r.channels === 'empty' ? 'channelsEmpty' : 'channelsPartial',
      hintKey: r.channels === 'empty' ? 'channelsEmpty' : 'channelsPartial',
    });
  }
  if (r.memories !== 'complete') {
    const remaining = Math.max(0, MEMORY_STRONG_THRESHOLD - r.counts.memoriesApproved);
    out.push({
      id: 'memories',
      severity: r.memories === 'empty' ? 1 : 0,
      priority: 6,
      tab: 'knowledge',
      icon: BookOpen,
      titleKey: r.memories === 'empty' ? 'memoriesEmpty' : 'memoriesPartial',
      hintKey: r.memories === 'empty' ? 'memoriesEmpty' : 'memoriesPartial',
      hintVars: { remaining, threshold: MEMORY_STRONG_THRESHOLD, approved: r.counts.memoriesApproved },
    });
  }

  // Empty (severity 1) before partial (severity 0); tie-break by foundation priority.
  return out.sort((a, b) => (b.severity - a.severity) || (a.priority - b.priority));
}

function severityClasses(s: MilestoneStatus): string {
  if (s === 'empty') return 'text-rose-300 bg-rose-500/10 border-rose-500/25';
  if (s === 'partial') return 'text-amber-300 bg-amber-500/10 border-amber-500/25';
  return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
}

function colorForScore(score: number): string {
  if (score >= 80) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/15';
  if (score >= 40) return 'bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-amber-500/15';
  return 'bg-secondary/40 text-foreground border-primary/10 hover:bg-secondary/60';
}

interface Props {
  readiness: TwinReadiness;
  onJumpTo: (tab: TwinTab) => void;
}

export function ReadinessGapPopover({ readiness, onJumpTo }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const gaps = buildGaps(readiness);
  const allSet = gaps.length === 0;
  const top = gaps.slice(0, 3);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={allSet ? t.gaps.allSetTooltip : t.gaps.openTooltip}
        className={`px-2 py-1 rounded-full text-[10px] font-medium border transition-colors focus-ring ${colorForScore(readiness.score)}`}
      >
        {tx(t.profiles.readyPercent, { pct: readiness.score })}
      </button>

      {open && (
        <div
          aria-label={t.gaps.dialogLabel}
          className="absolute right-0 top-full mt-2 z-50 w-80 rounded-card border border-primary/15 bg-card/95 backdrop-blur shadow-elevation-3 animate-fade-slide-in"
        >
          <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-primary/10">
            <div className="min-w-0">
              <p className="typo-caption text-foreground font-semibold">
                {allSet ? t.gaps.allSetTitle : t.gaps.title}
              </p>
              <p className="text-[11px] text-foreground/60 mt-0.5">
                {tx(t.gaps.subtitle, { pct: readiness.score })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.gaps.close}
              className="p-1 rounded-interactive text-foreground/55 hover:text-foreground hover:bg-secondary/40 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {allSet ? (
            <div className="px-3 py-4 flex flex-col items-center text-center gap-1.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              <p className="typo-caption text-foreground">{t.gaps.allSetBody}</p>
            </div>
          ) : (
            <ul className="py-1.5">
              {top.map((g) => {
                const status: MilestoneStatus = g.severity === 1 ? 'empty' : 'partial';
                const Icon = g.icon;
                const title = t.gaps.titles[g.titleKey];
                const hintTemplate = t.gaps.hints[g.hintKey];
                const hint = g.hintVars ? tx(hintTemplate, g.hintVars) : hintTemplate;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onJumpTo(g.tab);
                        setOpen(false);
                      }}
                      className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-secondary/40 transition-colors text-left focus-ring rounded-none"
                    >
                      <span className={`flex-shrink-0 w-7 h-7 rounded-interactive border flex items-center justify-center ${severityClasses(status)}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block typo-caption text-foreground font-medium truncate">{title}</span>
                        <span className="block text-[11px] text-foreground/60 leading-snug mt-0.5">{hint}</span>
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-foreground/40 flex-shrink-0 mt-1" />
                    </button>
                  </li>
                );
              })}
              {gaps.length > top.length && (
                <li className="px-3 py-1.5 text-[10px] text-foreground/50 uppercase tracking-wider border-t border-primary/10">
                  {tx(t.gaps.moreCount, { count: gaps.length - top.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
