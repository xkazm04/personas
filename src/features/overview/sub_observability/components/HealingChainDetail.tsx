/**
 * Observability (composition kit): a picked resilience chain's steps, hung on the detail pane's
 * spine in order (trigger, classify, retries, AI heal, outcome), each step's Mark saying what
 * it did. Details opens the issue the trigger raised, as a click on the trigger step did before.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KitButton, ListRow, Meta, Rows, Section } from '@/features/shared/components/kit';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import { chainMark, eventMark, type ChainGroup } from '../libs/issueModel';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

function stepWord(e: HealingTimelineEvent, w: ObservabilityWords): string {
  const { o, t } = w;
  switch (e.eventType) {
    case 'trigger': return o.events.col_trigger;
    case 'retry': return e.retryCount ? w.tx(o.healing_timeline.retry_badge, { count: e.retryCount }) : t.common.retry;
    case 'ai_heal': return o.healing_issues_panel.ai_healing_title;
    case 'outcome': return o.cockpit.fact_outcome;
    default: return e.eventType.replace('_', ' ');
  }
}

export function HealingChainDetail({ chain, onOpenIssue, w }: {
  chain: ChainGroup | null;
  onOpenIssue: (issueId: string) => void;
  w: ObservabilityWords;
}) {
  const { o } = w;
  if (!chain) {
    return <Section title={o.observability_extra.healing_view_timeline} state="empty" empty={{ title: o.healing_timeline.no_events, hint: o.healing_timeline.no_events_hint }} />;
  }
  const issueId = chain.events.find((e) => e.eventType === 'trigger' && e.issueId)?.issueId ?? null;
  const fixes = chain.events.filter((e) => e.suggestedFix);
  const m = chainMark(chain);
  return (
    <Section
      id="s-obs-chain"
      eyebrow={`${o.observability_extra.healing_view_timeline} · ${chain.outcome?.title ?? stepWord(chain.events[chain.events.length - 1]!, w)}`}
      title={chain.trigger?.title ?? chain.chainId}
      meta={<Meta parts={[chain.trigger?.severity, chain.trigger?.category]} />}
      state={m.glyph === 'live' ? 'live' : undefined}
      actions={issueId ? <KitButton onClick={() => onOpenIssue(issueId)} hint="↵" testId="obs-chain-open">{o.widgets.details}</KitButton> : undefined}
    >
      <Rows count={chain.events.length} empty={{ title: o.healing_timeline.no_events }}>
        {chain.events.map((e) => (
          <ListRow
            key={e.id}
            size="m"
            name={e.title}
            nameClass={e.eventType === 'trigger' ? 'typo-body k-strong' : 'typo-body k-regular'}
            meta={<Meta parts={[stepWord(e, w), e.description !== e.title ? e.description : null]} />}
            mark={{ ...eventMark(e), label: stepWord(e, w) }}
            state={eventMark(e).glyph === 'live' ? 'live' : undefined}
            time={<RelativeTime timestamp={e.timestamp} format="elapsed" showTooltip={false} />}
          />
        ))}
      </Rows>
      {fixes.length > 0 && (
        <Section level={2} title={o.healing_issue_modal.suggested_fix}>
          {fixes.map((e) => <p key={e.id} className="k-in typo-body" style={{ margin: '0 0 8px' }}>{e.suggestedFix}</p>)}
        </Section>
      )}
    </Section>
  );
}
