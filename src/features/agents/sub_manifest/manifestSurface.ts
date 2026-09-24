import type {
  DocumentAuthor,
  DocumentSection,
} from '@/features/shared/components/document';
import { parseDiffPreviews, type ManifestSection } from './manifestDocument';
import type { MemoryReviewProposal } from '@/lib/bindings/MemoryReviewProposal';

/** A slug safe for a testid, derived from the heading (`Operation defaults`
 *  -> `operation-defaults`) so a test can name the section it means. */
export function headingSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The id a section carries on the surface. The preamble has no heading, so it
 *  gets a reserved id rather than an empty one, which would collide. */
export function sectionId(section: ManifestSection, index: number): string {
  const slug = headingSlug(section.heading);
  return slug || `preamble-${index}`;
}

const AUTHOR: Record<ManifestSection['kind'], DocumentAuthor> = {
  law: 'you',
  self: 'agent',
  other: 'neither',
};

/**
 * Which pending proposals are aimed at one heading.
 *
 * The section path survives onto the wire only inside the proposal's summary
 * text, so this is the join between a pending change and the section it would
 * edit. A preview whose heading is not in the document belongs to nobody here
 * and is collected separately, so nothing pending is ever invisible.
 */
export function previewsFor(proposals: readonly MemoryReviewProposal[], heading: string) {
  return proposals
    .map((proposal) => ({
      proposal,
      previews: parseDiffPreviews(proposal.summary).filter(
        (d) => d.heading.toLowerCase() === heading.toLowerCase(),
      ),
    }))
    .filter((row) => row.previews.length > 0);
}

/**
 * The manifest as the shared document surface reads it.
 *
 * Only LAW sections are editable, and that is a product invariant rather than
 * a display choice: the self-model half changes only through a proposal a human
 * approves, so the surface must never offer a caret there.
 */
export function toDocumentSections(
  sections: readonly ManifestSection[],
  proposals: readonly MemoryReviewProposal[],
): DocumentSection[] {
  return sections.map((section, i) => ({
    id: sectionId(section, i),
    heading: section.heading,
    body: section.body,
    author: AUTHOR[section.kind],
    editable: section.kind === 'law',
    pendingCount:
      section.kind === 'self' ? previewsFor(proposals, section.heading).length : 0,
  }));
}
