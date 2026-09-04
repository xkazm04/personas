import { useMemo } from 'react';
import { FileText, ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ManifestLawSection } from './ManifestLawSection';
import { ManifestProposalCard } from './ManifestProposalCard';
import { ManifestSelfSection } from './ManifestSelfSection';
import { parseDiffPreviews, parseManifestSections } from './manifestDocument';
import { useManifest } from './useManifest';

/** Calm geometry-matched ghost UNDER the permanent chrome — never a spinner,
 *  and never in place of the header (loading pattern v2, law 1). */
function ManifestGhost() {
  return (
    <div className="space-y-5" aria-hidden data-testid="manifest-ghost">
      {[0, 1, 2].map((s) => (
        <div key={s} className="space-y-2">
          <div className="h-4 w-40 rounded-input bg-secondary/30 animate-pulse" />
          {[0, 1, 2].map((l) => (
            <div key={l} className="h-3 rounded-input bg-secondary/20 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The Manifest tab — the persona's core, as ONE document rather than a form.
 *
 * It has two authors and the page says so in place: the LAW sections
 * (`Mandate`, `Boundaries`, `Operation defaults`) are inline-editable by the
 * operator and save one section at a time; the SELF-MODEL sections are the
 * agent's own words, read-only, with every pending anchored diff shown at the
 * section it would change so accepting one is a decision about the text in
 * front of you.
 */
export function ManifestTab({ personaId }: { personaId: string }) {
  const { t, tx } = useTranslation();
  const m = t.agents.manifest;
  const { view, proposals, isLoading, saveLaw, decide } = useManifest(personaId);

  const sections = useMemo(
    () => (view ? parseManifestSections(view.content, view.lawSections, view.selfSections) : []),
    [view],
  );

  // Every heading the document actually renders, so a pending diff aimed at a
  // heading that is not in the file (a stale proposal, or a section the agent
  // invented) still reaches the operator instead of vanishing.
  const rendered = useMemo(
    () => new Set(sections.map((s) => s.heading.toLowerCase())),
    [sections],
  );
  const orphans = useMemo(
    () =>
      proposals
        .map((p) => ({
          proposal: p,
          previews: parseDiffPreviews(p.summary).filter(
            (d) => !d.heading || !rendered.has(d.heading.toLowerCase()),
          ),
        }))
        .filter((row) => row.previews.length > 0),
    [proposals, rendered],
  );

  const pendingCount = view?.pendingProposals ?? proposals.length;

  return (
    <div className="max-w-3xl space-y-5 pb-10" data-testid="manifest-tab">
      <header className="space-y-1 border-b border-primary/10 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="typo-title text-foreground inline-flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            {m.title}
          </h2>
          {pendingCount > 0 && (
            <span
              className="typo-label px-2 py-0.5 rounded-pill bg-primary/10 text-primary border border-primary/20"
              data-testid="manifest-pending-count"
            >
              {pendingCount === 1 ? m.pending_one : tx(m.pending_other, { count: pendingCount })}
            </span>
          )}
        </div>
        <p className="typo-caption text-foreground/85">
          {m.subtitle}
          {view?.updatedAt && (
            <>
              {' '}
              <span data-testid="manifest-updated">
                {m.updated}{' '}
                <RelativeTime timestamp={view.updatedAt} showTooltip={false} />
              </span>
            </>
          )}
        </p>
      </header>

      {sections.length === 0 ? (
        isLoading ? (
          <ManifestGhost />
        ) : (
          <EmptyState icon={FileText} title={m.empty_title} subtitle={m.empty_body} className="py-14" />
        )
      ) : (
        <div className="space-y-6" data-testid="manifest-document">
          {sections.map((section, i) =>
            section.kind === 'self' ? (
              <ManifestSelfSection
                key={`${section.heading}-${i}`}
                section={section}
                proposals={proposals}
                onDecide={decide}
              />
            ) : section.kind === 'law' ? (
              <ManifestLawSection
                key={`${section.heading}-${i}`}
                section={section}
                onSave={saveLaw}
              />
            ) : (
              // A heading the server claimed for neither author (and the
              // preamble, whose heading is empty): shown verbatim, editable by
              // nobody, so the document is never quietly partial.
              <section key={`${section.heading}-${i}`} className="space-y-2">
                {section.heading && (
                  <h3 className="typo-section-title text-foreground">{section.heading}</h3>
                )}
                {section.body && (
                  <MarkdownRenderer content={section.body} variant="document" />
                )}
              </section>
            ),
          )}

          {orphans.length > 0 && (
            <section className="space-y-2" data-testid="manifest-orphan-proposals">
              <h3 className="typo-section-title text-foreground">{m.orphan_title}</h3>
              <p className="typo-caption text-foreground/85">{m.orphan_body}</p>
              {orphans.map(({ proposal, previews }) => (
                <ManifestProposalCard
                  key={proposal.id}
                  proposalId={proposal.id}
                  createdAt={proposal.createdAt}
                  previews={previews}
                  onDecide={decide}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
