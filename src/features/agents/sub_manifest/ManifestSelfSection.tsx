import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { MemoryReviewProposal } from '@/lib/bindings/MemoryReviewProposal';
import { headingSlug } from './ManifestLawSection';
import { ManifestProposalCard } from './ManifestProposalCard';
import { parseDiffPreviews, type ManifestSection } from './manifestDocument';

interface ManifestSelfSectionProps {
  section: ManifestSection;
  /** Every pending self-model proposal; this section keeps the ones aimed at it. */
  proposals: MemoryReviewProposal[];
  onDecide: (proposalId: string, accept: boolean) => Promise<void>;
}

/**
 * One SELF-MODEL section — the agent's own account of its work, read-only by
 * law: it changes only through an anchored diff a human approves. Any pending
 * diff aimed at this heading renders directly beneath the text it would edit.
 */
export function ManifestSelfSection({ section, proposals, onDecide }: ManifestSelfSectionProps) {
  const { t } = useTranslation();
  const m = t.agents.manifest;
  const slug = headingSlug(section.heading);

  const pending = proposals
    .map((p) => ({
      proposal: p,
      previews: parseDiffPreviews(p.summary).filter(
        (d) => d.heading.toLowerCase() === section.heading.toLowerCase(),
      ),
    }))
    .filter((row) => row.previews.length > 0);

  return (
    <section className="space-y-2" data-testid={`manifest-section-${slug}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="typo-section-title text-foreground">{section.heading}</h3>
        <span className="inline-flex items-center gap-1 typo-label text-foreground/85">
          <Bot className="w-3 h-3" />
          {m.self_note}
        </span>
      </div>

      {section.body ? (
        <MarkdownRenderer content={section.body} />
      ) : (
        <p className="typo-caption text-foreground/85">{m.self_empty}</p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2 pt-1" data-testid={`manifest-pending-${slug}`}>
          {pending.map(({ proposal, previews }) => (
            <ManifestProposalCard
              key={proposal.id}
              proposalId={proposal.id}
              createdAt={proposal.createdAt}
              previews={previews}
              onDecide={onDecide}
            />
          ))}
        </div>
      )}
    </section>
  );
}
