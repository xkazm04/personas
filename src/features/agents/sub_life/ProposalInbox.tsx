import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listPersonaMemoryReviewProposals,
  applyPersonaMemoryReviewProposal,
  discardPersonaMemoryReviewProposal,
  type MemoryReviewProposal,
} from '@/api/overview/memories';
import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import type { DecisionAction } from '@/features/shared/components/decisions/decisionTypes';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { proposalsCache, identityCache } from './lifeCache';

interface ProposalInboxProps {
  personaId: string;
  /** Fired after an APPLIED proposal (self-model diffs change identity.md). */
  onApplied: (kind: string) => void;
}

/**
 * Pending consolidation proposals — every write to memories or the self-model
 * passes this human gate. Accept applies, reject discards; both go through the
 * shared `apply/discard_persona_memory_review_proposal` doors.
 */
export function ProposalInbox({ personaId, onApplied }: ProposalInboxProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [proposals, setProposals] = useState<MemoryReviewProposal[]>(
    () => proposalsCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!proposalsCache.has(personaId));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await listPersonaMemoryReviewProposals(personaId, true);
      // `responsibility_draft` rows belong to the Responsibilities tab's own
      // draft inbox, which renders the typed charter. Listing them here too
      // would show the same pending decision in two places, and this card
      // cannot render a charter — its body branches on memory/self-model only.
      const rows = all.filter((p) => p.kind !== 'responsibility_draft');
      proposalsCache.set(personaId, rows);
      setProposals(rows);
    } catch (err) {
      silentCatch('life:listProposals')(err);
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setProposals(proposalsCache.get(personaId) ?? []);
    void load();
  }, [personaId, load]);

  const decide = async (p: MemoryReviewProposal, accept: boolean) => {
    setBusyId(p.id);
    try {
      if (accept) {
        await applyPersonaMemoryReviewProposal(p.id);
        if (p.kind === 'self_model_diff') identityCache.invalidate(personaId);
        onApplied(p.kind);
      } else {
        await discardPersonaMemoryReviewProposal(p.id);
      }
      await load();
    } catch (err) {
      toastCatch('life:decideProposal', life.save_failed)(err);
    } finally {
      setBusyId(null);
    }
  };

  const kindLabel = (kind: string) =>
    kind === 'self_model_diff' ? life.brain_kind_self_model : life.brain_kind_memory;

  return (
    <div data-testid="life-brain-proposals">
      <SectionCard title={life.brain_proposals_title}>
        {proposals.length === 0 ? (
          isLoading ? (
            <div className="space-y-1.5" aria-hidden>
              {[0, 1].map((i) => (
                <div key={i} className="h-12 rounded-input bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <p className="typo-caption py-2">{life.brain_proposals_empty}</p>
          )
        ) : (
          <ul className="divide-y divide-primary/5">
            {proposals.map((p) => {
              const actions: DecisionAction[] = [
                {
                  id: 'apply',
                  label: t.common.apply,
                  tone: 'accept',
                  loading: busyId === p.id,
                  disabled: busyId != null && busyId !== p.id,
                  onClick: () => void decide(p, true),
                },
                {
                  id: 'discard',
                  label: life.brain_discard,
                  tone: 'reject',
                  disabled: busyId != null,
                  onClick: () => void decide(p, false),
                },
              ];
              return (
                <Fragment key={p.id}>
                  <DecisionRow
                    record={{
                      id: p.id,
                      title: kindLabel(p.kind),
                      summary: p.summary ?? p.instructions ?? null,
                      category: kindLabel(p.kind),
                      accentClass: p.kind === 'self_model_diff' ? 'border-l-violet-400' : 'border-l-cyan-400',
                      facts: [
                        { label: life.brain_fact_reviewed, value: p.reviewedCount },
                        { label: life.brain_fact_changes, value: p.proposedChanges },
                      ],
                      timestamp: p.createdAt,
                    }}
                    actions={actions}
                    active={openId === p.id}
                    onOpen={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
                    testId={`life-brain-proposal-${p.id}`}
                  />
                  {openId === p.id && (
                    <li className="mx-4 mb-3 px-3 py-2 rounded-input bg-secondary/25 border border-primary/10 list-none">
                      {p.kind === 'self_model_diff' ? (
                        // The summary carries one preview line per anchored diff.
                        <pre className="typo-code whitespace-pre-wrap break-words text-foreground/85">
                          {p.summary ?? ''}
                        </pre>
                      ) : (
                        <ul className="space-y-1">
                          {p.entries.map((e) => (
                            <li key={e.memoryId} className="flex items-center gap-2 typo-caption">
                              <span className="typo-code px-1.5 py-px rounded-pill bg-primary/10 text-primary/80 border border-primary/15">
                                {e.action}
                              </span>
                              <span className="text-foreground/85 truncate">{e.title}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
