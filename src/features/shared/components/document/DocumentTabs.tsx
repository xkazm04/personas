import type { DocumentSection } from './documentModel';

interface DocumentTabsProps {
  sections: readonly DocumentSection[];
  openId: string;
  onOpen: (id: string) => void;
  /**
   * The id prefix the surface also stamps on the open section, so each tab's
   * `aria-controls` resolves to a real `role="tabpanel"` element.
   *
   * Required, not defaulted: a prefix invented here could not be known by the
   * element that has to answer to it, so the reference would be emitted and
   * dangle. A control does not claim to drive a region it cannot name.
   */
  idPrefix: string;
}

/** The panel id for a section, shared by the tab and the panel it controls. */
export function documentPanelId(idPrefix: string, sectionId: string): string {
  return `${idPrefix}-panel-${sectionId}`;
}

/** The tab id, so the panel can point back with `aria-labelledby`. */
export function documentTabId(idPrefix: string, sectionId: string): string {
  return `${idPrefix}-tab-${sectionId}`;
}

/**
 * @catalog DocumentTabs — the tab buttons inside DocumentSurface's strip. Part of DocumentSurface, not a standalone primitive: it renders the tabs and deliberately not the `role="tablist"` that holds them.
 *
 * The document's chapters as a top switcher: numbered, named, underlined in
 * the author's colour when open, carrying a live count of what is waiting.
 * Styled by `documentSurface.css` (`.ds-tab`), ported from the contest winner.
 *
 * IT RENDERS THE TABS AND NOT THE `role="tablist"` THAT HOLDS THEM. The strip
 * element lives in `DocumentSurface` beside the `role="tabpanel"` it drives,
 * so the control and the region it claims to control are declared together.
 */
export function DocumentTabs({ sections, openId, onOpen, idPrefix }: DocumentTabsProps) {
  return (
    <>
      {sections.map((section, i) => {
        const open = section.id === openId;
        const pending = section.pendingCount ?? 0;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={documentTabId(idPrefix, section.id)}
            aria-selected={open}
            aria-controls={documentPanelId(idPrefix, section.id)}
            onClick={() => onOpen(section.id)}
            className={`focus-ring ds-tab ds-tone-${section.author} ${open ? 'is-on' : ''}`}
            data-role="doc-tab"
            data-testid={`document-tab-${section.id}`}
          >
            <span className="ds-tab-n">{i + 1}</span>
            <span className="ds-tab-t">{section.heading}</span>
            {pending > 0 && (
              <span className="ds-tab-p" data-testid={`document-tab-pending-${section.id}`}>
                {pending}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
