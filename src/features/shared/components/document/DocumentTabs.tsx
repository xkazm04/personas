import { AUTHOR_TONE } from './documentTokens';
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
 * The document's chapters as a top switcher: numbered, named, coloured by
 * author, carrying a live count of what is waiting in each.
 *
 * It is the fast route to a section that the navigation rail also reaches
 * slowly — deliberately two ways to the same place, because the rail answers
 * "how big is it and where am I" and this answers "take me to the third one".
 *
 * IT RENDERS THE TABS AND NOT THE `role="tablist"` THAT HOLDS THEM. The strip
 * element lives in `DocumentSurface` beside the `role="tabpanel"` it drives,
 * so the control and the region it claims to control are declared together and
 * an `aria-controls` written here cannot point at an element no file renders.
 */
export function DocumentTabs({ sections, openId, onOpen, idPrefix }: DocumentTabsProps) {
  return (
    <>
      {sections.map((section, i) => {
        const tone = AUTHOR_TONE[section.author];
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
            className={`focus-ring shrink-0 inline-flex items-center gap-1.5 rounded-interactive px-2.5 py-1.5 border-b-2 transition-colors ${
              open
                ? `${tone.text} border-current`
                : 'text-foreground border-transparent hover:bg-secondary/40'
            }`}
            data-testid={`document-tab-${section.id}`}
          >
            <span className={`typo-label ${open ? '' : tone.text}`}>{i + 1}</span>
            <span className="typo-title">{section.heading}</span>
            {pending > 0 && (
              <span
                className={`typo-label rounded-pill px-1.5 ${tone.wash} ${tone.text}`}
                data-testid={`document-tab-pending-${section.id}`}
              >
                {pending}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
