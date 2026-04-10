import { MessageSquare, ChevronRight, AlertTriangle, Brain, Zap, BookOpen, Target } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { ParsedOutput } from './outputParser';

export function UserMessageCard({ msg }: { msg: NonNullable<ParsedOutput['userMessage']> }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      {msg.title && (
        <div className="px-4 py-3 border-b border-primary/8 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary/60" />
          <span className="text-sm font-semibold text-foreground/90">{msg.title}</span>
          {msg.priority && msg.priority !== 'normal' && (
            <span className={`text-sm px-1.5 py-0.5 rounded-full font-semibold uppercase ${
              msg.priority === 'high' || msg.priority === 'urgent'
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>{msg.priority}</span>
          )}
        </div>
      )}
      <div className="px-4 py-3">
        {msg.content && <MarkdownRenderer content={msg.content} className="text-sm" />}
      </div>
    </div>
  );
}

export function FlowSteps({ flow }: { flow: NonNullable<ParsedOutput['executionFlow']> }) {
  const steps = flow.flows ?? [];
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const s = step as Record<string, unknown>;
        const status = String(s.status ?? '');
        const statusColor = status === 'completed' ? 'text-emerald-400' : status === 'failed' ? 'text-red-400' : 'text-muted-foreground/50';
        return (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/10">
            <span className="text-sm font-mono text-foreground w-5 text-right">{String(s.step ?? i + 1)}</span>
            <ChevronRight className="w-3 h-3 text-foreground" />
            <span className="text-sm text-foreground flex-1">{String(s.action ?? '').replace(/_/g, ' ')}</span>
            <span className={`text-sm font-medium ${statusColor}`}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewsList({ reviews }: { reviews: Record<string, unknown>[] }) {
  return (
    <div className="space-y-2.5">
      {reviews.map((r, i) => (
        <div key={i} className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3.5 space-y-2">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            {typeof r.title === 'string' && <span className="text-sm font-semibold text-foreground/85">{r.title}</span>}
            {typeof r.severity === 'string' && (
              <span className={`text-sm px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                r.severity === 'high' || r.severity === 'critical'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>{String(r.severity)}</span>
            )}
          </div>
          {typeof r.description === 'string' && <p className="text-sm text-foreground leading-relaxed">{r.description}</p>}
          {typeof r.context_data === 'string' && (
            <div className="px-3 py-2 rounded-lg bg-black/10 font-mono text-sm text-foreground">{r.context_data}</div>
          )}
          {Array.isArray(r.suggested_actions) && r.suggested_actions.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Suggested Actions</span>
              {(r.suggested_actions as string[]).map((a, j) => (
                <div key={j} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="text-primary/40 mt-0.5">&#8226;</span><span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function MemoriesList({ memories }: { memories: Record<string, unknown>[] }) {
  return (
    <div className="space-y-2">
      {memories.map((m, i) => (
        <div key={i} className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <Brain className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              {typeof m.title === 'string' && <div className="text-sm font-medium text-foreground/85 mb-1">{m.title}</div>}
              <div className="text-sm text-foreground">{String(m.content ?? m.text ?? m.key ?? JSON.stringify(m))}</div>
              <div className="flex items-center gap-2 mt-1.5">
                {typeof m.category === 'string' && <span className="text-sm px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400/80">{m.category}</span>}
                {typeof m.importance === 'number' && <span className="text-sm text-foreground">importance: {m.importance}/10</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventsList({ events }: { events: Record<string, unknown>[] }) {
  return (
    <div className="space-y-2">
      {events.map((e, i) => (
        <div key={i} className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-400/80">{String(e.type ?? e.event_type ?? 'event')}</span>
          </div>
          {typeof e.data === 'object' && e.data && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-black/10 font-mono text-sm text-foreground whitespace-pre-wrap">
              {JSON.stringify(e.data, null, 2)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function KnowledgeSection({ annotation }: { annotation: Record<string, unknown> }) {
  return (
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3.5 space-y-2">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-foreground/85">Knowledge Insight</span>
        {typeof annotation.confidence === 'number' && (
          <span className="text-sm text-foreground ml-auto">{Math.round(annotation.confidence * 100)}% confidence</span>
        )}
      </div>
      {typeof annotation.scope === 'string' && (
        <span className="inline-block text-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/80 font-mono">{annotation.scope}</span>
      )}
      {typeof annotation.note === 'string' && (
        <p className="text-sm text-foreground leading-relaxed">{annotation.note}</p>
      )}
    </div>
  );
}

export function OutcomeSection({ data }: { data: Record<string, unknown> }) {
  const oa = data.outcome_assessment as Record<string, unknown> | undefined;
  if (!oa) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Target className="w-4 h-4 text-primary/60" />
        <span className="text-sm font-semibold text-foreground/85">Outcome Assessment</span>
        <span className={`text-sm px-1.5 py-0.5 rounded-full font-semibold uppercase ${
          oa.accomplished ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>{oa.accomplished ? 'Accomplished' : 'Not Accomplished'}</span>
      </div>
      {typeof oa.summary === 'string' && <p className="text-sm text-foreground leading-relaxed">{oa.summary}</p>}
      {Array.isArray(oa.blockers) && oa.blockers.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Blockers</span>
          {(oa.blockers as string[]).map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-red-400/80">
              <span className="mt-0.5">&#8226;</span><span>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
