import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './documentSurface.css';
import type { DocumentSection } from './documentModel';
import { DocumentTabs, documentPanelId, documentTabId } from './DocumentTabs';
import { DocumentRail } from './DocumentRail';
import { DocumentPage } from './DocumentPage';
import { DocumentClosedRow } from './DocumentClosedRow';
import { useDocumentSurface } from './useDocumentSurface';
import { useChapterScroll } from './useChapterScroll';
import { DocumentTurnHint } from './DocumentTurnHint';
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
  /** Rendered inside the open leaf, under its prose — waiting changes, provenance. */
  renderSectionFooter?: (section: DocumentSection) => ReactNode;
  /** Rendered at the end of the stack. */
  children?: ReactNode;
}

/**
 * @catalog DocumentSurface — a long-form two-author document as a bound book: a to-scale side rail (parametrized), a chapter switcher with waiting counts, the whole document as a stack in file order with one chapter open as a paper leaf and the rest as quiet closed leaves, and click-a-row-to-write-in-it inline editing that saves a chapter whole. Prefer it over a stack of headings with an Edit button per section.
 *
 * PROMOTED FROM A DESIGN CONTEST, AND HELD TO IT. The look — page surface,
 * stitched binding, reading type, measure, author colours — lives in
 * `documentSurface.css` and is verified against the winner's measured style
 * contract (`.contest/harness/style-contract.py`), because the first port
 * written from memory of the winner lost every property the owner chose it for
 * while every code gate stayed green.
 *
 * Four behaviours hold it together:
 * 1. **The whole document in one view, in file order**: one chapter open at
 *    full measure, every other one a closed leaf you can read the edge of.
 * 2. **A rail drawn to scale**, so the document's shape is legible before
 *    anything is scrolled. Optional; it earns its column once a section grows.
 * 3. **One click on a row selects it and, on the operator's own chapter, puts
 *    the caret there.** A row is a single bullet, not the list around it.
 * 4. **A chapter saves whole**, from its own markdown — no HTML round-trip.
 *
 * `role="tablist"` and `role="tabpanel"` are declared together in this file so
 * every tab's `aria-controls` resolves. State and drafts live in
 * {@link useDocumentSurface}; the leaf's contents in `DocumentPage`.
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
  const pageRef = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState<'next' | 'prev' | null>(null);
  const at = s.open ? sections.indexOf(s.open) : -1;
  const next = sections[at + 1];
  const prev = at > 0 ? sections[at - 1] : undefined;

  const turnTo = useCallback(
    (target: DocumentSection | undefined, dir: 'next' | 'prev') => {
      if (!target) return;
      setEntered(dir);
      s.openSection(target.id);
    },
    [s],
  );
  const turn = useChapterScroll({
    pageRef,
    enabled: !s.writing,
    hasNext: !!next,
    hasPrev: !!prev,
    onNext: () => turnTo(next, 'next'),
    onPrev: () => turnTo(prev, 'prev'),
  });

  // After a scroll turn, bring the new chapter's arriving edge into view: its
  // top when reading on, its end when reading back, so the gesture continues.
  useEffect(() => {
    if (!entered || !pageRef.current) return;
    const still =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.getAttribute('data-motion') === 'reduce';
    pageRef.current.scrollIntoView({ block: entered === 'next' ? 'start' : 'end', behavior: still ? 'auto' : 'smooth' });
  }, [entered, s.open?.id]);

  if (!s.open) return null;
  const open = s.open;
  const canWrite = open.editable && !!onSaveSection;
  // Any other way of opening a chapter (tab, rail, closed leaf) is not a turn.
  const openBy = (id: string) => {
    setEntered(null);
    s.openSection(id);
  };

  return (
    <div className="ds-surface flex min-h-0" data-testid="document-surface">
      {sidePanel && (
        <aside className="ds-rail-col w-[14.5rem] shrink-0 flex-col self-start border-r border-primary/10 pr-3">
          <DocumentRail
            sections={sections}
            openId={open.id}
            onOpen={openBy}
            label={labels.railLabel}
            caption={labels.railCaption}
            header={sidePanelHeader}
            footer={sidePanelFooter}
            meta={(section, lines) => `${labels.mark(section.author)} · ${labels.lines(lines)}`}
          />
        </aside>
      )}

      <div className="min-w-0 flex-1">
        <div role="tablist" aria-label={labels.tabsLabel} className="ds-tabs px-6" data-testid="document-tabs">
          <DocumentTabs sections={sections} openId={open.id} onOpen={openBy} idPrefix={idPrefix} />
        </div>

        <div className="px-6 pb-10 pt-5">
          <div className="ds-stack" data-role="doc-measure">
            {sections.map((section, i) =>
              section.id === open.id ? (
                <section
                  key={section.id}
                  ref={pageRef}
                  role="tabpanel"
                  id={documentPanelId(idPrefix, section.id)}
                  aria-labelledby={documentTabId(idPrefix, section.id)}
                  tabIndex={-1}
                  className={`ds-page ds-tone-${section.author} ${s.writing && canWrite ? 'is-writing' : ''} ${
                    entered ? `enter-${entered}` : ''
                  }`}
                  data-role="doc-page"
                  data-testid={`document-open-${section.id}`}
                >
                  <DocumentTurnHint turn={turn} edge="prev" label={prev ? labels.scrollBack(at, prev.heading) : null} />
                  <DocumentPage
                    section={section}
                    labels={labels}
                    canWrite={canWrite}
                    blocks={s.blocks}
                    selectedBlockId={s.selectedBlockId}
                    clicked={s.clicked}
                    hasDraft={s.hasDraft(section.id)}
                    editingIndex={s.editingIndex}
                    caret={s.caret}
                    onSelectBlock={(block) => s.selectBlock(block, canWrite)}
                    onEditRow={s.editRow}
                    onSplitRow={s.splitRow}
                    onRemoveRow={s.deleteRow}
                    onMoveRow={s.moveRow}
                    onSave={s.save}
                    onStopWriting={s.stopWriting}
                    footer={renderSectionFooter?.(section)}
                  />
                  <DocumentTurnHint turn={turn} edge="next" label={next ? labels.scrollOn(at + 2, next.heading) : null} />
                </section>
              ) : (
                <DocumentClosedRow
                  key={section.id}
                  section={section}
                  index={i}
                  onOpen={openBy}
                  mark={labels.mark(section.author)}
                  linesLabel={labels.lines}
                  waitingLabel={labels.waiting}
                  draftLabel={s.hasDraft(section.id) ? labels.draftMark : undefined}
                />
              ),
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
