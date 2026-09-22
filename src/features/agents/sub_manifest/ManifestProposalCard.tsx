import { GitPullRequestArrow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ContentCard } from '@/features/shared/components/content';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { toastCatch } from '@/lib/silentCatch';
import type { ManifestDiffPreview } from './manifestDocument';

interface ManifestProposalCardProps {
  proposalId: string;
  createdAt: string;
  /** Only the previews aimed at the section this card renders under. */
  previews: ManifestDiffPreview[];
  onDecide: (proposalId: string, accept: boolean) => Promise<void>;
}

/** The quoted body of an `add: "…"` preview, so the card shows the line itself. */
function proposedText(text: string): string {
  const m = /^(?:add|replace|remove)?:?\s*[“"]([\s\S]*)[”"]\s*$/.exec(text.trim());
  return m?.[1] ?? text;
}

/**
 * One pending `self_model_diff` proposal, rendered IN PLACE inside the leaf it
 * would edit rather than in a separate inbox — the change and the text it
 * changes are read together. Accept applies it through the shared
 * `apply_persona_memory_review_proposal` door; reject discards it.
 *
 * Presentation is the execution-detail content card (`content/ContentCard`,
 * violet: the tone that surface gives the agent's own memories), so a waiting
 * change on the manifest reads as the same kind of object it does on a run.
 * The proposed line is shown in the page's reading type, as the line it would
 * become, with its target path above it.
 *
 * A proposal spanning several sections appears under each one it touches,
 * showing only that section's lines; deciding it anywhere decides all of it,
 * which is what the server's per-proposal gate means.
 */
export function ManifestProposalCard({ proposalId, createdAt, previews, onDecide }: ManifestProposalCardProps) {
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
    <ContentCard
      tone="violet"
      icon={<GitPullRequestArrow />}
      title={m.proposal_title}
      trailing={<RelativeTime timestamp={createdAt} className="typo-caption text-foreground" />}
      data-testid={`manifest-proposal-${proposalId}`}
    >
      <div className="space-y-2">
        {previews.map((p, i) => (
          <div key={`${p.section}-${i}`} className="space-y-1">
            {p.section && <p className="typo-label text-violet-400">{p.section}</p>}
            {/* Same renderer and the same page prose as a content row, so the
                proposed line reads exactly as it will once accepted — the
                owner saw `typo-body-lg` here drift from the rows above it. */}
            {p.text && (
              <div className="ds-prose" data-role="proposal-text">
                <MarkdownRenderer content={proposedText(p.text)} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <AsyncButton size="sm" variant="primary" onClick={() => decide(true)} data-testid={`manifest-proposal-accept-${proposalId}`}>
          {t.common.apply}
        </AsyncButton>
        <AsyncButton size="sm" variant="ghost" onClick={() => decide(false)} data-testid={`manifest-proposal-reject-${proposalId}`}>
          {t.common.reject}
        </AsyncButton>
      </div>
    </ContentCard>
  );
}
