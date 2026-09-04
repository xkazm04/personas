import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listPersonaMemoryReviewProposals,
  applyPersonaMemoryReviewProposal,
  discardPersonaMemoryReviewProposal,
  type MemoryReviewProposal,
} from '@/api/overview/memories';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { toastCatch, silentCatch } from '@/lib/silentCatch';

/** The proposal `kind` the attention loop's improve lane files charters under. */
export const RESPONSIBILITY_DRAFT_KIND = 'responsibility_draft';

interface CharterDraftInboxProps {
  personaId: string;
  /** Refresh the charter list — approving a draft MINTS a charter row. */
  onApplied: () => void;
}

/**
 * Charters the agent proposes for itself.
 *
 * `responsibility_draft` proposals carry no `entries` (the payload is one
 * object, not a `ProposalEntry` array) — the charter lives on the typed
 * `draft` field, with `summary` as the one-line rationale. Approving goes
 * through the same `apply_persona_memory_review_proposal` door every other
 * proposal kind uses; the server forces `source = 'agent-proposed'` and
 * `status = 'draft'` and derives the owner from the proposal row, so the
 * minted charter always lands on the draft rung of the ladder.
 */
export function CharterDraftInbox({ personaId, onApplied }: CharterDraftInboxProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const [rows, setRows] = useState<MemoryReviewProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const all = await listPersonaMemoryReviewProposals(personaId, true);
      setRows(all.filter((p) => p.kind === RESPONSIBILITY_DRAFT_KIND));
    } catch (err) {
      silentCatch('responsibilities:listDraftProposals')(err);
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  const decide = async (p: MemoryReviewProposal, accept: boolean) => {
    try {
      if (accept) await applyPersonaMemoryReviewProposal(p.id);
      else await discardPersonaMemoryReviewProposal(p.id);
      await load();
      if (accept) onApplied();
    } catch (err) {
      toastCatch('responsibilities:decideDraft', c.draft_decide_failed)(err);
    }
  };

  const columns: TableColumn<MemoryReviewProposal>[] = [
    {
      key: 'title',
      label: c.draft_title_label,
      width: 'minmax(160px, 1.2fr)',
      render: (p) => (
        <span className="typo-body text-foreground/90 truncate">
          {p.draft?.title ?? c.draft_untitled}
        </span>
      ),
    },
    {
      key: 'domain',
      label: c.draft_domain_label,
      width: '130px',
      render: (p) =>
        p.draft?.domain ? (
          <StatusBadge size="sm" accent="slate">{p.draft.domain}</StatusBadge>
        ) : null,
    },
    {
      key: 'summary',
      label: c.draft_summary_label,
      width: 'minmax(200px, 2fr)',
      render: (p) => <span className="typo-caption text-foreground">{p.summary ?? ''}</span>,
    },
    {
      key: 'actions',
      label: '',
      width: '180px',
      render: (p) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <AsyncButton
            size="xs"
            variant="primary"
            onClick={() => decide(p, true)}
            data-testid={`resp-draft-approve-${p.id}`}
          >
            {c.draft_approve}
          </AsyncButton>
          <AsyncButton
            size="xs"
            variant="ghost"
            onClick={() => decide(p, false)}
            data-testid={`resp-draft-discard-${p.id}`}
          >
            {c.draft_discard}
          </AsyncButton>
        </div>
      ),
    },
  ];

  return (
    <SectionCard title={c.draft_inbox_title}>
      <div data-testid="resp-draft-inbox">
        <UnifiedTable<MemoryReviewProposal>
          columns={columns}
          data={rows}
          getRowKey={(p) => p.id}
          isLoading={isLoading}
          emptyTitle={c.draft_inbox_empty_title}
          emptyDescription={c.draft_inbox_empty_body}
          density="compact"
          rowHeight={48}
          className="max-h-[24rem]"
        />
      </div>
    </SectionCard>
  );
}
