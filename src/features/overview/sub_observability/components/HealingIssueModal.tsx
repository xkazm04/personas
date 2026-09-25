/**
 * The full health issue, in the shared BaseModal's own panel (its radius and 85vh cap; the
 * override that dropped the cap let a tall issue run under the titlebar). Inside, the kit:
 * a Section on a spine whose Mark vocabulary matches the list (issueModel), the analysis and
 * the suggested fix as level-2 Sections, the facts as a KeyValueGrid, the actions as
 * KitButtons with the product's real spinner while resolving.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Dot, KeyValueGrid, KitButton, KitHost, Meta, Section, Surface } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { silentCatch } from '@/lib/silentCatch';
import { ISSUE_GLYPH, canResolve, issueState } from '../libs/issueModel';
import { useObservabilityWords, type ObservabilityWords } from '../libs/useObservabilityWords';

interface HealingIssueModalProps {
  issue: PersonaHealingIssue;
  onResolve: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function HealingIssueModal({ issue, onResolve, onClose }: HealingIssueModalProps) {
  const w = useObservabilityWords();
  const [resolved, setResolved] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!resolved) return;
    const timer = setTimeout(onClose, 800);
    return () => clearTimeout(timer);
  }, [resolved, onClose]);

  const handleResolve = useCallback(async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await onResolve(issue.id);
      setResolved(true);
    } catch (err) {
      silentCatch('HealingIssueModal:resolve')(err);
    } finally {
      setResolving(false);
    }
  }, [onResolve, issue.id, resolving]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="healing-issue-title" maxWidthClass="max-w-xl" staggerChildren={false}>
      <KitHost compact testId="healing-issue-modal">
        {resolved
          ? (
            <div className="animate-fade-scale-in flex flex-col items-center justify-center gap-4 py-16 px-8">
              <CheckCircle className="w-10 h-10 text-status-success" strokeWidth={1.5} />
              <p className="typo-heading text-status-success">{w.o.healing_issue_modal.issue_resolved}</p>
            </div>
          )
          : <IssueBody issue={issue} w={w} resolving={resolving} onResolve={handleResolve} onClose={onClose} />}
      </KitHost>
    </BaseModal>
  );
}

function IssueBody({ issue, w, resolving, onResolve, onClose }: {
  issue: PersonaHealingIssue;
  w: ObservabilityWords;
  resolving: boolean;
  onResolve: () => void;
  onClose: () => void;
}) {
  const { o, t } = w;
  const m = o.healing_issue_modal;
  const s = issueState(issue);
  const open = canResolve(s);
  return (
    <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: '20px 8px 4px 4px' }}>
        <Surface>
          <Section
            eyebrow={`${o.healing_issues_panel.title} · ${w.state[s]}`}
            title={<span id="healing-issue-title">{issue.title}</span>}
            meta={<Meta parts={[issue.category, <AbsoluteTime key="at" timestamp={issue.created_at} variant="date" />]} />}
            state={s === 'fixed' || s === 'resolved' ? 'muted' : undefined}
          >
            {s === 'breaker' && (
              <p className="k-in typo-body flex items-start gap-2" style={{ margin: '0 0 12px' }}>
                <Dot tone="error" />
                <span><span className="k-strong">{m.persona_auto_disabled}.</span> {m.persona_auto_disabled_desc}</span>
              </p>
            )}
            <Section level={2} title={m.analysis}>
              <p className="k-in typo-body whitespace-pre-wrap" style={{ margin: 0 }}>{issue.description}</p>
            </Section>
            {issue.suggested_fix && (
              <Section
                level={2}
                title={m.suggested_fix}
                actions={<CopyButton text={issue.suggested_fix} label={m.copy_fix} copiedLabel={m.copied} />}
              >
                <p className="k-in typo-body whitespace-pre-wrap" style={{ margin: 0 }}>{issue.suggested_fix}</p>
              </Section>
            )}
            <KeyValueGrid
              min="140px"
              items={[
                { k: t.common.status, v: w.state[s], draw: <Dot {...ISSUE_GLYPH[s]} /> },
                { k: o.incidents.filter_severity_label, v: issue.severity },
                { k: w.t.agents.activity.execution, v: issue.execution_id ? <span className="typo-code">{issue.execution_id}</span> : null, none: t.common.none },
              ]}
            />
          </Section>
        </Surface>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-primary/10" style={{ padding: '12px 16px' }}>
        <span className="typo-caption mr-auto flex items-center gap-2" style={{ flex: '1 1 240px' }}>
          {s === 'retrying' && <><Dot glyph="live" />{m.retry_in_progress}</>}
          {s === 'fixed' && <><Dot tone="success" glyph="hollow" />{m.auto_resolved}</>}
          {open && m.marking_resolved_note}
        </span>
        <KitButton quiet onClick={onClose}>{m.close}</KitButton>
        {open && (
          <KitButton onClick={onResolve} loading={resolving} testId="healing-issue-resolve">
            {resolving ? m.resolving : m.mark_resolved}
          </KitButton>
        )}
      </footer>
    </div>
  );
}
