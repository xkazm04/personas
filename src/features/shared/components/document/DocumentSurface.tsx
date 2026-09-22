import { useId, type ReactNode } from 'react';
import { AUTHOR_TONE, DOCUMENT_MEASURE } from './documentTokens';
import type { DocumentSection } from './documentModel';
import { DocumentTabs, documentPanelId, documentTabId } from './DocumentTabs';
import { DocumentRail } from './DocumentRail';
import { DocumentBlocks } from './DocumentBlocks';
import { DocumentEditor } from './DocumentEditor';
import { DocumentClosedRow } from './DocumentClosedRow';
import { useDocumentSurface } from './useDocumentSurface';
import type { DocumentSurfaceLabels } from './documentLabels';

export interface DocumentSurfaceProps {
  sections: readonly DocumentSection[];
  labels: DocumentSurfaceLabels;
  /**
   * Whether the to-scale navigation rail is present. The parametrized side
   * panel: a surface with three short sections does not need it, and one with
   * a section that grows without bound cannot do without it.
   */
  sidePanel?: boolean;
  /** Rendered at the top of the rail when `sidePanel` is on. */
  sidePanelHeader?: ReactNode;
  /** Rendered at the bottom of the rail when `sidePanel` is on. */
  sidePanelFooter?: ReactNode;
  /**
   * Save one section's body, WHOLE. Rejecting keeps the editor open with the
   * draft intact, so a failed write never looks like a successful one.
   */
  onSaveSection?: (sectionId: string, body: string) => Promise<void>;
  /** Rendered under a section's prose — pending changes, provenance, actions. */
  renderSectionFooter?: (section: DocumentSection) => ReactNode;
  /** Rendered under the closed rows. */
  children?: ReactNode;
}

/**
 * @catalog DocumentSurface — a long-form two-author document as a reading and writing instrument: a to-scale side rail (parametrized), a top chapter switcher with waiting counts, one section open at full measure with the rest present but muted, and click-a-paragraph-to-write-in-it inline editing that saves a section whole. Prefer it over a stack of headings with an Edit button per section.
 *
 * Four things hold this together, and each was chosen against an alternative
 * that looked simpler:
 *
 * 1. **One section open, the rest present.** Not pagination (which hides the
 *    document's shape and defeats the browser's own find) and not one long
 *    scroll (which is the known failure once a section grows past a screen).
 * 2. **A rail drawn to scale**, so the shape of the document is legible before
 *    anything is scrolled. Optional, because it only earns its column once a
 *    section can grow without bound.
 * 3. **One click selects a paragraph and opens the caret in it** where the
 *    section is the operator's. Where it is not, the click still selects and
 *    the surface says why typing is not on offer.
 * 4. **A section saves whole.** The editor holds the section's own markdown,
 *    so what is stored is what was on screen — there is no HTML round-trip in
 *    which a heading marker or a list indent can quietly go missing.
 *
 * State, including the drafts this component never discards, lives in
 * {@link useDocumentSurface}.
 */
export function DocumentSurface({
  sections,
  labels,
  sidePanel = true,
  sidePanelHeader,
  sidePanelFooter,
  onSaveSection,
  renderSectionFooter,
  children,
}: DocumentSurfaceProps) {
  const idPrefix = useId();
  const s = useDocumentSurface({ sections, onSaveSection });

  if (!s.open) return null;
  const open = s.open;
  const tone = AUTHOR_TONE[open.author];
  const canWrite = open.editable && !!onSaveSection;

  return (
    <div className="flex min-h-0 gap-4" data-testid="document-surface">
      {sidePanel && (
        <div className="hidden w-52 shrink-0 md:flex md:flex-col">
          <DocumentRail
            sections={sections}
            openId={open.id}
            onOpen={s.openSection}
            label={labels.railLabel}
            header={sidePanelHeader}
            footer={sidePanelFooter}
            linesLabel={labels.lines}
          />
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-4">
        {/* The strip and the panel it drives are declared together, in this
            file and in this order, so every tab's `aria-controls` resolves to
            an element that is actually rendered. */}
        <div
          role="tablist"
          aria-label={labels.tabsLabel}
          className="flex items-center gap-1 overflow-x-auto border-b border-primary/10 pb-px"
          data-testid="document-tabs"
        >
          <DocumentTabs
            sections={sections}
            openId={open.id}
            onOpen={s.openSection}
            idPrefix={idPrefix}
          />
        </div>

        <section
          role="tabpanel"
          id={documentPanelId(idPrefix, open.id)}
          aria-labelledby={documentTabId(idPrefix, open.id)}
          tabIndex={-1}
          className={`${DOCUMENT_MEASURE} space-y-3`}
          data-testid={`document-open-${open.id}`}
        >
          <header className="space-y-1">
            <p className={`typo-label ${tone.text}`}>
              {labels.author(open.author)}
              {canWrite ? ` · ${labels.savesWhole}` : ''}
            </p>
            <h3 className="typo-section-title text-foreground">{open.heading}</h3>
          </header>

          {s.writing && canWrite ? (
            <DocumentEditor
              value={s.body}
              onChange={s.setDraft}
              onSave={s.save}
              onStopWriting={s.stopWriting}
              caretAt={s.caretAt}
              labels={labels.editor(open.heading)}
              testIdSuffix={open.id}
            />
          ) : s.blocks.length > 0 ? (
            <>
              <DocumentBlocks
                blocks={s.blocks}
                selectedId={s.selectedBlockId}
                onSelect={(block) => s.selectBlock(block, canWrite)}
                editable={canWrite}
                blockActionLabel={labels.writeHere}
              />
              {!canWrite && s.selectedBlockId && (
                <p className="typo-caption text-foreground" data-testid="document-readonly-note">
                  {labels.readOnlyNote}
                </p>
              )}
              {s.hasDraft && (
                <p className="typo-caption text-foreground" data-testid="document-draft-note">
                  {labels.draftKept}
                </p>
              )}
            </>
          ) : (
            <p className="typo-caption text-foreground">{labels.empty}</p>
          )}

          {renderSectionFooter?.(open)}
        </section>

        {s.closed.length > 0 && (
          <div className="space-y-1.5" data-testid="document-closed-rows">
            {s.closed.map((section) => (
              <DocumentClosedRow
                key={section.id}
                section={section}
                index={sections.indexOf(section)}
                onOpen={s.openSection}
                linesLabel={labels.lines}
                waitingLabel={labels.waiting}
                authorLabel={labels.author(section.author)}
              />
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
