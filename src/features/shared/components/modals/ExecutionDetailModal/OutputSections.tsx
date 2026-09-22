import { MessageSquare, ChevronRight, AlertTriangle, Brain, Zap, BookOpen, Target, ShieldCheck, ShieldAlert } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ParsedOutput } from './outputParser';
import { analyzeProvenance } from './provenance';
import { useTranslation } from '@/i18n/useTranslation';
import {
  ContentBullets,
  ContentCard,
  ContentEyebrow,
  ContentPill,
  ContentWell,
} from '@/features/shared/components/content';

/**
 * Trust signal for a report's traceability (UAT P7 — F-NO-PROVENANCE): green
 * when the deliverable cites sources you can audit, muted-amber when it reports
 * figures with no Sources section, nothing for plain operational messages.
 */
function ProvenanceBadge({ content }: { content?: string }) {
  const { t, tx } = useTranslation();
  const { sourceCount, hasFigures } = analyzeProvenance(content);
  if (sourceCount > 0) {
    return (
      <Tooltip content={tx(t.overview.provenance.sourced_tip, { count: sourceCount })} placement="top">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ShieldCheck className="w-3 h-3" />
          {sourceCount}
        </span>
      </Tooltip>
    );
  }
  if (hasFigures) {
    return (
      <Tooltip content={t.overview.provenance.unsourced_tip} placement="top">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <ShieldAlert className="w-3 h-3" />
          {t.overview.provenance.unsourced}
        </span>
      </Tooltip>
    );
  }
  return null;
}

export function UserMessageCard({ msg }: { msg: NonNullable<ParsedOutput['userMessage']> }) {
  const { sourceCount, hasFigures } = analyzeProvenance(msg.content);
  const showHeader = Boolean(msg.title) || sourceCount > 0 || hasFigures;
  return (
    <ContentCard
      variant="framed"
      icon={showHeader ? <MessageSquare /> : undefined}
      title={showHeader ? msg.title : undefined}
      badges={
        showHeader && msg.priority && msg.priority !== 'normal' ? (
          <ContentPill tone={msg.priority === 'high' || msg.priority === 'urgent' ? 'red' : 'amber'}>
            {msg.priority}
          </ContentPill>
        ) : undefined
      }
      trailing={showHeader ? <ProvenanceBadge content={msg.content} /> : undefined}
    >
      {msg.content && <MarkdownRenderer content={msg.content} className="typo-body" />}
    </ContentCard>
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
        const statusColor = status === 'completed' ? 'text-emerald-400' : status === 'failed' ? 'text-red-400' : 'text-foreground';
        return (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/10">
            <span className="text-sm font-mono text-foreground w-5 text-right">{String(s.step ?? i + 1)}</span>
            <ChevronRight className="w-3 h-3 text-foreground" />
            <span className="typo-body text-foreground flex-1">{String(s.action ?? '').replace(/_/g, ' ')}</span>
            <span className={`typo-body font-medium ${statusColor}`}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewsList({ reviews }: { reviews: Record<string, unknown>[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2.5">
      {reviews.map((r, i) => (
        <ContentCard
          key={i}
          tone="amber"
          icon={<AlertTriangle />}
          title={typeof r.title === 'string' ? r.title : undefined}
          badges={
            typeof r.severity === 'string' ? (
              <ContentPill tone={r.severity === 'high' || r.severity === 'critical' ? 'red' : 'amber'}>
                {String(r.severity)}
              </ContentPill>
            ) : undefined
          }
        >
          {typeof r.description === 'string' && <p className="typo-body text-foreground leading-relaxed">{r.description}</p>}
          {typeof r.context_data === 'string' && <ContentWell>{r.context_data}</ContentWell>}
          {Array.isArray(r.suggested_actions) && r.suggested_actions.length > 0 && (
            <div className="space-y-1 pt-1">
              <ContentEyebrow>{t.shared.execution_detail.suggested_actions}</ContentEyebrow>
              <ContentBullets items={r.suggested_actions as string[]} />
            </div>
          )}
        </ContentCard>
      ))}
    </div>
  );
}

export function MemoriesList({ memories }: { memories: Record<string, unknown>[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {memories.map((m, i) => (
        <div key={i} className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <Brain className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              {typeof m.title === 'string' && <div className="typo-body font-medium text-foreground/85 mb-1">{m.title}</div>}
              <div className="typo-body text-foreground">{String(m.content ?? m.text ?? m.key ?? JSON.stringify(m))}</div>
              <div className="flex items-center gap-2 mt-1.5">
                {typeof m.category === 'string' && <span className="typo-body px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400/80">{m.category}</span>}
                {typeof m.importance === 'number' && <span className="typo-body text-foreground">{t.shared.execution_detail.importance_prefix} {m.importance}/10</span>}
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
            <span className="typo-body font-medium text-amber-400/80">{String(e.type ?? e.event_type ?? 'event')}</span>
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
  const { t } = useTranslation();
  return (
    <ContentCard
      tone="emerald"
      icon={<BookOpen />}
      title={t.shared.execution_detail.knowledge_insight}
      trailing={
        typeof annotation.confidence === 'number' ? (
          <span className="typo-body text-foreground">
            {Math.round(annotation.confidence * 100)}{t.shared.execution_detail.confidence_suffix}
          </span>
        ) : undefined
      }
    >
      {typeof annotation.scope === 'string' && (
        <span className="inline-block text-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/80 font-mono">{annotation.scope}</span>
      )}
      {typeof annotation.note === 'string' && (
        <p className="typo-body text-foreground leading-relaxed">{annotation.note}</p>
      )}
    </ContentCard>
  );
}

export function OutcomeSection({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const oa = data.outcome_assessment as Record<string, unknown> | undefined;
  if (!oa) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Target className="w-4 h-4 text-primary/60" />
        <span className="typo-heading font-semibold text-foreground/85">{t.shared.execution_detail.outcome_assessment}</span>
        <span className={`typo-heading px-1.5 py-0.5 rounded-full font-semibold uppercase ${
          oa.accomplished ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>{oa.accomplished ? 'Accomplished' : 'Not Accomplished'}</span>
      </div>
      {typeof oa.summary === 'string' && <p className="typo-body text-foreground leading-relaxed">{oa.summary}</p>}
      {Array.isArray(oa.blockers) && oa.blockers.length > 0 && (
        <div className="space-y-1">
          <span className="typo-heading font-semibold text-foreground uppercase tracking-wider">{t.shared.execution_detail.blockers}</span>
          {(oa.blockers as string[]).map((b, i) => (
            <div key={i} className="flex items-start gap-2 typo-body text-red-400/80">
              <span className="mt-0.5">&#8226;</span><span>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
