import { GitPullRequestArrow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { toastCatch } from '@/lib/silentCatch';
import type { ManifestDiffPreview } from './manifestDocument';

interface ManifestProposalCardProps {
  proposalId: string;
  createdAt: string;
  /** Only the previews aimed at the section this card renders under. */
  previews: ManifestDiffPreview[];
  onDecide: (proposalId: string, accept: boolean) => Promise<void>;
}

/**
 * One pending `self_model_diff` proposal, rendered IN PLACE at the section it
 * would edit rather than in a separate inbox — the change and the text it
 * changes are read together. Accept applies it through the shared
 * `apply_persona_memory_review_proposal` door; reject discards it.
 *
 * A proposal spanning several sections appears under each one it touches,
 * showing only that section's lines; deciding it anywhere decides all of it,
 * which is what the server's per-proposal gate means.
 */
export function ManifestProposalCard({
  proposalId,
  createdAt,
  previews,
  onDecide,
}: ManifestProposalCardProps) {
  const { t } = useTranslation();
  const m = t.agents.manifest;

  const decide = async (accept: boolean) => {
    try {
      await onDecide(proposalId, accept);
    } catch (err) {
      toastCatch('manifest:decideProposal', m.decide_failed)(err);
    }
  };

  return (
    <div
      className="rounded-card border border-primary/20 border-l-[3px] border-l-violet-400 bg-secondary/25 px-3 py-2.5 space-y-2"
      data-testid={`manifest-proposal-${proposalId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 typo-label text-foreground">
          <GitPullRequestArrow className="w-3 h-3" />
          {m.proposal_title}
        </span>
        <RelativeTime timestamp={createdAt} className="typo-caption text-foreground/85" />
      </div>

      <ul className="space-y-1">
        {previews.map((p, i) => (
          <li key={`${p.section}-${i}`} className="typo-caption text-foreground/85">
            <span className="text-foreground">{p.section}</span>
            {p.text ? ` ${p.text}` : ''}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <AsyncButton
          size="sm"
          variant="primary"
          onClick={() => decide(true)}
          data-testid={`manifest-proposal-accept-${proposalId}`}
        >
          {t.common.apply}
        </AsyncButton>
        <AsyncButton
          size="sm"
          variant="ghost"
          onClick={() => decide(false)}
          data-testid={`manifest-proposal-reject-${proposalId}`}
        >
          {t.common.reject}
        </AsyncButton>
      </div>
    </div>
  );
}
