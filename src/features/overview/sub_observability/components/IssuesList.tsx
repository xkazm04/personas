import { useState, useCallback, useRef, useEffect } from 'react';
import { Compass, KeyRound } from 'lucide-react';
import { HEALING_CATEGORY_COLORS, formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { HealingIssueStatusBadge, HealingRetryChip } from './HealingIssueStatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

interface IssuesListProps {
  issues: PersonaHealingIssue[];
  onSelectIssue: (issue: PersonaHealingIssue) => void;
  onResolve: (id: string) => void;
}

export function IssuesList({ issues, onSelectIssue, onResolve }: IssuesListProps) {
  const { t } = useTranslation();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset keyboard focus when the issue list identity changes (e.g. a filter
  // chip shortens/reorders it) — otherwise focusedIndex can point past the
  // new length, leaving the listbox with no tab stop.
  useEffect(() => {
    setFocusedIndex(-1);
    rowRefs.current.length = issues.length;
  }, [issues]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (issues.length === 0) return;
      let nextIndex: number;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = focusedIndex < issues.length - 1 ? focusedIndex + 1 : 0;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = focusedIndex > 0 ? focusedIndex - 1 : issues.length - 1;
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < issues.length) {
        e.preventDefault();
        onSelectIssue(issues[focusedIndex]!);
        return;
      } else {
        return;
      }
      setFocusedIndex(nextIndex);
      rowRefs.current[nextIndex]?.focus();
    },
    [focusedIndex, issues, onSelectIssue],
  );

  return (
    <div
      role="listbox"
      className="divide-y divide-primary/5 bg-gradient-to-b from-transparent to-black/[0.02]"
      onKeyDown={handleKeyDown}
    >
      {issues.map((issue, index) => {
        const ageLabel = formatRelativeTime(issue.created_at);
        const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
        const isAutoFixPending = issue.status === 'auto_fix_pending';
        const isCircuitBreaker = issue.is_circuit_breaker;

        return (
          <div
            key={issue.id}
            ref={(el) => { rowRefs.current[index] = el; }}
            role="option"
            aria-selected={focusedIndex === index}
            tabIndex={focusedIndex === index ? 0 : -1}
            onClick={() => onSelectIssue(issue)}
            onFocus={() => setFocusedIndex(index)}
            className={`flex items-center gap-4 px-4 py-4 hover:bg-foreground/[0.03] transition-colors group cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:outline-none ${isAutoFixed ? 'opacity-70' : ''} ${isCircuitBreaker ? 'bg-red-500/5' : ''}`}
          >
            <HealingIssueStatusBadge issue={issue} variant="compact" />
            <HealingRetryChip issue={issue} variant="compact" />
            <button
              onClick={() => onSelectIssue(issue)}
              className={`flex-1 text-left typo-body transition-colors line-clamp-2 ${isCircuitBreaker ? 'text-red-400/90 hover:text-red-300 font-medium' : isAutoFixed ? 'text-foreground/90 line-through decoration-emerald-500/30' : 'text-foreground hover:text-foreground'}`}
            >
              {issue.title}
            </button>
            {issue.source === 'director' && (
              <span
                title={t.director.healing_source_hint}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code uppercase rounded-card border bg-violet-500/15 text-violet-300 border-violet-500/25"
              >
                <Compass className="w-3 h-3" /> {t.director.healing_source_badge}
              </span>
            )}
            {issue.source === 'oauth' && (
              <span
                title={t.overview.healing_issues_panel.oauth_source_hint}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code uppercase rounded-card border bg-amber-500/15 text-amber-300 border-amber-500/25"
              >
                <KeyRound className="w-3 h-3" /> {t.overview.healing_issues_panel.oauth_source_badge}
              </span>
            )}
            <span className={`typo-code min-w-[90px] text-right ${HEALING_CATEGORY_COLORS[issue.category]?.text || 'text-foreground'}`}>
              {issue.category}
            </span>
            <span className="typo-body text-foreground w-16 text-right">{ageLabel}</span>
            {!isAutoFixed && !isAutoFixPending && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(issue.id);
                }}
                className="px-2 py-1 typo-heading text-emerald-400 hover:bg-emerald-500/10 rounded-card transition-colors"
              >
                {t.common.resolve}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
