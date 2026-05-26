import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { buildGaps } from './readinessGaps';
import type { TwinTab } from '@/lib/types/types';
import type { MilestoneStatus, TwinReadiness } from '../useTwinReadiness';

/**
 * Readiness popover. Replaces the static "{pct}% ready" badge with a clickable
 * trigger that opens a list of the highest-impact gaps for the active twin
 * and deep-links the user into the matching sub-tab.
 *
 * The gap ranking itself lives in `readinessGaps.ts` so the Profiles hero
 * "next step" nudge can reuse the exact same prioritisation.
 */

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
  const [showAll, setShowAll] = useState(false);
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

  // Reset to collapsed when the popover closes — re-opening from a fresh
  // state matches what most users expect (the popover is a quick triage tool;
  // a remembered expanded state would surprise on re-open weeks later).
  useEffect(() => {
    if (!open) setShowAll(false);
  }, [open]);

  const gaps = buildGaps(readiness);
  const allSet = gaps.length === 0;
  const top = showAll ? gaps : gaps.slice(0, 3);

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
              <p className="text-[11px] text-foreground mt-0.5">
                {tx(t.gaps.subtitle, { pct: readiness.score })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.gaps.close}
              className="p-1 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors flex-shrink-0"
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
                        <span className="block text-[11px] text-foreground leading-snug mt-0.5">{hint}</span>
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-foreground flex-shrink-0 mt-1" />
                    </button>
                  </li>
                );
              })}
              {gaps.length > 3 && (
                <li className="border-t border-primary/10">
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="w-full text-left px-3 py-1.5 text-[10px] text-violet-300 hover:text-violet-200 hover:bg-violet-500/8 transition-colors uppercase tracking-wider"
                  >
                    {showAll
                      ? t.gaps.showFewer
                      : tx(t.gaps.showAllGaps, { count: gaps.length })}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
