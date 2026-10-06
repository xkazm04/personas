// @catalog ReportBody - the body of a long-form document (persona report, council report): `html` renders in the sanitized HtmlDocumentFrame, `markdown` through RichMarkdown on the serif `document` variant.
/**
 * ONE reading body for every long-form document the app shows, so a report
 * in the Messages modal, a council's full report and a Decision Center card
 * cannot drift into three renderers.
 *
 * Markdown goes through `RichMarkdown`, not bare `MarkdownRenderer`.
 * Verified 2026-10-06 by reading both: `RichMarkdown` IS `MarkdownRenderer`
 * plus a remark-directive layer and extra element renderers merged OVER the
 * built-ins, so GFM tables, rehype-highlight code and ```chart bar blocks
 * render exactly as before; what it adds is the SurfaceSpec tag vocabulary
 * (`:::stats`, `:::table`, ...). An unknown inline tag is restored to its
 * literal source, so prose like `status:ok` is unchanged.
 */
import { HtmlDocumentFrame } from './HtmlDocumentFrame';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';

/**
 * The document shape this body reads. STRUCTURALLY the Decision Center's
 * `DecisionDocument` (`features/decision-center/model/decisionModel.ts`),
 * restated here rather than imported because the catalog may not import a
 * feature (eslint `no-restricted-imports`, catalog boundary). A
 * `DecisionDocument` is assignable to it as-is.
 */
export interface ReportDocument {
  format: 'markdown' | 'html';
  content: string;
  mediaScope?: string | null;
}

export interface ReportBodyProps {
  document: ReportDocument;
  /** Accessible name for an HTML document's frame. Pre-translated. */
  title: string;
  /** Resolves a relative media reference in an HTML document; see HtmlDocumentFrame. */
  resolveMedia?: (src: string) => Promise<string | null>;
  /**
   * Surface-specific flourishes over the markdown `document` variant (the
   * Messages modal's drop cap and measure). Ignored for `html`, whose
   * document owns its own styling.
   */
  className?: string;
}

export function ReportBody({ document, title, resolveMedia, className }: ReportBodyProps) {
  if (document.format === 'html') {
    return <HtmlDocumentFrame html={document.content} title={title} resolveMedia={resolveMedia} />;
  }
  return <RichMarkdown content={document.content} variant="document" className={className} />;
}
