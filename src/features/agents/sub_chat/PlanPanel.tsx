import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Circle, CircleCheck, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING, LIST_ITEM_GAP } from '@/lib/utils/designTokens';
import type { TodoItem } from '@/lib/types/terminalEvents';

// ── Plan Panel ──────────────────────────────────────────────────────────
//
// Renders the latest TodoWrite emission as a collapsible checklist. Mounted
// inside ChatTab above the messages flexbox so the plan stays in view while
// the conversation continues (the same pattern Claude Code Desktop uses for
// its sidebar plan view — see /research run 2026-04-25 for context).
//
// TodoWrite re-emits the full latest array on every update, so this component
// is purely a renderer — the chat slice owns the latest array.

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CircleCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" aria-hidden />;
    case 'in_progress':
      return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" aria-hidden />;
    default:
      return <Circle className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />;
  }
}

export function PlanPanel({ todos }: { todos: TodoItem[] }) {
  const { t, tx } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const counts = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    for (const item of todos) {
      if (item.status === 'completed') completed += 1;
      else if (item.status === 'in_progress') inProgress += 1;
      else pending += 1;
    }
    return { completed, inProgress, pending };
  }, [todos]);

  if (todos.length === 0) return null;

  const countLabel = todos.length === 1
    ? tx(t.agents.chat.plan_count_one, { count: todos.length })
    : tx(t.agents.chat.plan_count_other, { count: todos.length });

  return (
    <div
      className="border-b border-primary/[0.08] bg-secondary/[0.02]"
      data-testid="chat-plan-panel"
    >
      <div className={`max-w-3xl mx-auto ${CARD_PADDING.dense}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="chat-plan-panel-list"
          aria-label={expanded ? t.agents.chat.plan_collapse : t.agents.chat.plan_expand}
          data-testid="chat-plan-panel-toggle"
          className={`w-full flex items-center ${LIST_ITEM_GAP.cards} typo-body-sm text-foreground hover:text-primary transition-colors focus-ring rounded-input py-1`}
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
            : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />}
          <span className="font-medium">{t.agents.chat.plan_title}</span>
          <span className="text-foreground">{countLabel}</span>
          <span className={`ml-auto flex items-center ${LIST_ITEM_GAP.cards} text-foreground text-[11px] tabular-nums`}>
            <span aria-label={t.agents.chat.plan_status_completed}>{counts.completed} ✓</span>
            {counts.inProgress > 0 && (
              <span aria-label={t.agents.chat.plan_status_in_progress}>{counts.inProgress} ⋯</span>
            )}
            {counts.pending > 0 && (
              <span aria-label={t.agents.chat.plan_status_pending}>{counts.pending} ◯</span>
            )}
          </span>
        </button>
        {expanded && (
          <ul
            id="chat-plan-panel-list"
            data-testid="chat-plan-panel-list"
            className={`mt-1 mb-1 flex flex-col ${LIST_ITEM_GAP.dense}`}
          >
            {todos.map((item, i) => {
              const isCompleted = item.status === 'completed';
              const isInProgress = item.status === 'in_progress';
              const label = isInProgress && item.active_form
                ? item.active_form
                : item.content;
              return (
                <li
                  key={`${i}-${item.content}`}
                  className={`flex items-start ${LIST_ITEM_GAP.cards} typo-body-sm text-foreground`}
                >
                  <span className="mt-[3px]">{statusIcon(item.status)}</span>
                  <span className={isCompleted ? 'text-foreground line-through' : ''}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
