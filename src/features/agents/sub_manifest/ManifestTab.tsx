import { useCallback, useMemo } from 'react';
import { FileText, ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DocumentSurface } from '@/features/shared/components/document';
import { ManifestProposalCard } from './ManifestProposalCard';
import { ManifestGhost } from './ManifestGhost';
import { parseDiffPreviews, parseManifestSections } from './manifestDocument';
import { previewsFor, toDocumentSections } from './manifestSurface';
import { useManifestLabels } from './useManifestLabels';
import { useManifest } from './useManifest';

/**
 * The Manifest tab — the persona's core, as ONE document rather than a form.
 *
 * It has two authors and the page says so in place: the LAW sections
 * (`Mandate`, `Boundaries`, `Operation defaults`) are the operator's and are
 * written inline, one section saved whole; the SELF-MODEL sections are the
 * agent's own words, read-only, with every pending anchored diff shown at the
 * section it would change so accepting one is a decision about the text in
 * front of you.
 *
 * The reading and writing instrument itself is
 * `shared/components/document/DocumentSurface` — a to-scale rail, a chapter
 * switcher, one section open at full measure with the rest present but muted,
 * and click-a-paragraph-to-write-in-it. This tab supplies the data, the
 * vocabulary, and what hangs under a section; it owns no layout of its own.
 */
export function ManifestTab({ personaId }: { personaId: string }) {
  const { t, tx } = useTranslation();
  const m = t.agents.manifest;
  const labels = useManifestLabels();
  const { view, proposals, isLoading, saveLaw, decide } = useManifest(personaId);

  const sections = useMemo(
    () => (view ? parseManifestSections(view.content, view.lawSections, view.selfSections) : []),
    [view],
  );
  const documentSections = useMemo(
    () => toDocumentSections(sections, proposals),
    [sections, proposals],
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

  // The surface speaks in section ids; `update_persona_manifest_law` speaks in
  // headings, so the crossing happens here and nowhere else.
  const saveSection = useCallback(
    async (id: string, body: string) => {
      const target = documentSections.find((s) => s.id === id);
      if (!target) return;
      await saveLaw(target.heading, body);
    },
    [documentSections, saveLaw],
  );

  const pendingCount = view?.pendingProposals ?? proposals.length;

  return (
    <div className="space-y-5 pb-10" data-testid="manifest-tab">
      <header className="max-w-3xl space-y-1 border-b border-primary/10 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="typo-title inline-flex items-center gap-2">
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
        <p className="typo-caption text-foreground">
          {m.subtitle}
          {view?.updatedAt && (
            <>
              {' '}
              <span data-testid="manifest-updated">
                {m.updated} <RelativeTime timestamp={view.updatedAt} showTooltip={false} />
              </span>
            </>
          )}
        </p>
      </header>

      {documentSections.length === 0 ? (
        isLoading ? (
          <ManifestGhost />
        ) : (
          <EmptyState icon={FileText} title={m.empty_title} subtitle={m.empty_body} className="py-14" />
        )
      ) : (
        <DocumentSurface
          sections={documentSections}
          labels={labels}
          sidePanel
          onSaveSection={saveSection}
          renderSectionFooter={(section) => {
            const pending = previewsFor(proposals, section.heading);
            if (pending.length === 0) return null;
            return (
              <div className="space-y-2 pt-1" data-testid={`manifest-pending-${section.id}`}>
                {pending.map(({ proposal, previews }) => (
                  <ManifestProposalCard
                    key={proposal.id}
                    proposalId={proposal.id}
                    createdAt={proposal.createdAt}
                    previews={previews}
                    onDecide={decide}
                  />
                ))}
              </div>
            );
          }}
        >
          {orphans.length > 0 && (
            <section className="space-y-2 pt-2" data-testid="manifest-orphan-proposals">
              <h3 className="typo-section-title">{m.orphan_title}</h3>
              <p className="typo-caption text-foreground">{m.orphan_body}</p>
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
        </DocumentSurface>
      )}
    </div>
  );
}
