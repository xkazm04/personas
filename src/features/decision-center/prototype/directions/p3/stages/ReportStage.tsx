/**
 * report / council — the reading room's page. Markdown renders through the
 * shared document variant with heading ids from the ONE slug law
 * (`headingSlug`); HTML goes through the sandboxed HtmlDocumentFrame.
 */
import { isValidElement, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { MARKDOWN_DOCUMENT_DENSITY } from '@/features/shared/components/editors/markdownVariants';
import { HtmlDocumentFrame } from '@/features/shared/components/document/HtmlDocumentFrame';
import type { DecisionItem } from '../../../../model/decisionModel';
import { headingSlug, readerMarkdown } from '../model';
import { READER_CHROME_OFFSET } from './useReading';

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

const d = MARKDOWN_DOCUMENT_DENSITY;
const HEADINGS: Components = {
  h2: ({ children }) => <h2 id={headingSlug(textOf(children))} className={d.h2}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingSlug(textOf(children))} className={d.h3}>{children}</h3>,
};

export function ReportStage({ item }: { item: DecisionItem }) {
  const doc = item.document;
  const style = useMemo(() => ({ '--p3-chrome-offset': `${READER_CHROME_OFFSET}px` }) as CSSProperties, []);
  if (!doc) return <p className="typo-body px-6 text-foreground">{item.body}</p>;
  if (doc.format === 'html') {
    return (
      <div className="flex flex-col gap-2 px-6 pb-6">
        <span className="typo-caption">Agent-authored HTML · shown in a sandboxed frame, scripts off</span>
        <HtmlDocumentFrame html={doc.content} title={item.title}
          className="rounded-card border border-border" />
      </div>
    );
  }
  return (
    <article className="p3-reader mx-auto w-full max-w-[72ch] px-6 pb-10" style={style}>
      <MarkdownRenderer content={readerMarkdown(item)} variant="document" components={HEADINGS} />
    </article>
  );
}
