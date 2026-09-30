/**
 * Observability (composition kit): the selected health issue's detail layer (the side pane on a
 * wide surface, the drawer on a narrow one). Its facts are a KeyValueGrid; Details (or Enter)
 * opens the full issue modal, as a click on the row did before the kit.
 */
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Dot, KeyValueGrid, KitButton, Meta, Section } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { ISSUE_GLYPH, canResolve, issueState } from '../libs/issueModel';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

export function HealingIssueDetail({ issue, personaName, onOpen, onResolve, w }: {
  issue: PersonaHealingIssue | null;
  personaName: (id: string) => string | null;
  onOpen: (issue: PersonaHealingIssue) => void;
  onResolve: (id: string) => void;
  w: ObservabilityWords;
}) {
  const { o, t } = w;
  if (!issue) {
    return <Section title={o.healing_issues_panel.title} state="empty" empty={{ title: o.healing_issues_panel.no_open_issues, hint: o.healing_issues_panel.run_analysis_hint }} />;
  }
  const s = issueState(issue);
  const persona = personaName(issue.persona_id);
  return (
    <Section
      id="s-obs-issue"
      eyebrow={`${o.healing_issues_panel.title} · ${w.state[s]}`}
      title={issue.title}
      meta={<Meta parts={[issue.category, persona]} />}
      state={s === 'fixed' || s === 'resolved' ? 'muted' : undefined}
      actions={
        <>
          {canResolve(s) && <KitButton quiet onClick={() => onResolve(issue.id)}>{t.common.resolve}</KitButton>}
          <KitButton onClick={() => onOpen(issue)} hint="↵" testId="obs-issue-open">{o.widgets.details}</KitButton>
        </>
      }
    >
      {issue.description && issue.description !== issue.title && (
        <p className="k-in typo-body" style={{ margin: '0 0 12px' }}>{issue.description}</p>
      )}
      <KeyValueGrid
        min="130px"
        items={[
          { k: t.common.status, v: w.state[s], draw: <Dot {...ISSUE_GLYPH[s]} /> },
          { k: o.incidents.filter_severity_label, v: issue.severity },
          { k: o.memory_table.category, v: issue.category },
          { k: o.incidents.detail_label_persona, v: persona, none: o.activity.unknown },
          { k: o.incidents.detail_label_source, v: issue.source ? w.source[issue.source] ?? issue.source : null, none: t.common.none },
          { k: t.common.created, v: <AbsoluteTime timestamp={issue.created_at} variant="compact" /> },
          { k: o.incidents.resolved_at_label, v: issue.resolved_at ? <AbsoluteTime timestamp={issue.resolved_at} variant="compact" /> : null, none: t.common.none },
          { k: w.t.agents.activity.execution, v: issue.execution_id ? <span className="typo-code">{issue.execution_id}</span> : null, none: t.common.none },
        ]}
      />
      {issue.suggested_fix && (
        <Section level={2} title={o.healing_issue_modal.suggested_fix}>
          <p className="k-in typo-body" style={{ margin: 0 }}>{issue.suggested_fix}</p>
        </Section>
      )}
    </Section>
  );
}
