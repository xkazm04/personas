/**
 * The long-form reader for report and council cards: the document (markdown
 * at the `document` density, or agent HTML in the sandboxed frame) under one
 * sticky progress bar — the reader's only fixed chrome, whose height is the
 * one offset every jump and the reading band withdraw from. Its contents list
 * lives in the ledger rail (`ReaderContents`), so the decision dock below it
 * stays reachable however far the reader scrolls.
 */
import { motion } from 'framer-motion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { HtmlDocumentFrame } from '@/features/shared/components/document/HtmlDocumentFrame';
import { Button } from '@/features/shared/components/buttons';
import { formatPercent } from '@/lib/utils/formatters';
import type { DecisionItem } from '../../../model/decisionModel';
import { READER_CHROME_OFFSET, type PreparedDocument } from './readerDocument';
import type { ReaderState } from './useReader';

export function ReportReader({ item, doc, reader }: { item: DecisionItem; doc: PreparedDocument; reader: ReaderState }) {
  const isHtml = item.document?.format === 'html';
  const section = doc.headings.find((h) => h.id === reader.active)?.text;
  return (
    <div ref={reader.scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" data-r2b-scroll={item.id} data-testid="r2b-reader">
      <div
        className="r2b-reader-bar"
        style={{ height: READER_CHROME_OFFSET }}
      >
        <span className="min-w-0 flex-1 truncate typo-caption">
          {isHtml ? 'HTML document' : section ?? 'Start'}
        </span>
        <span className="typo-data r2b-num text-foreground">{formatPercent(reader.progress, { fromRatio: true, precision: 0 })}</span>
        <span className="r2b-progress" aria-hidden>
          <motion.span
            animate={{ scaleX: reader.progress }}
            transition={{ duration: 0.12 }}
          />
        </span>
      </div>
      {isHtml ? (
        <div className="mx-auto max-w-[960px] px-6 py-6">
          <HtmlDocumentFrame html={item.document!.content} title={item.title} className="rounded-card" />
        </div>
      ) : (
        <div ref={reader.articleRef} className="mx-auto max-w-[72ch] px-8 py-6">
          <MarkdownRenderer content={item.document?.content ?? item.body} variant="document" />
        </div>
      )}
    </div>
  );
}

export function ReaderContents({ doc, reader, isHtml }: { doc: PreparedDocument; reader: ReaderState; isHtml: boolean }) {
  return (
    <nav className="flex flex-col" aria-label="Contents" data-testid="r2b-contents">
      <span className="typo-eyebrow r2b-unit pb-1">Contents</span>
      {isHtml || doc.headings.length === 0 ? (
        <span className="typo-caption">No outline — this document carries its own layout.</span>
      ) : (
        doc.headings.map((h) => {
          const on = h.id === reader.active;
          return (
            <Button
              key={h.id}
              variant="ghost"
              size="xs"
              onClick={() => reader.jump(h.id)}
              aria-current={on ? 'location' : undefined}
              className="r2b-toc"
              style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
            >
              <span className="typo-caption text-current">{h.text}</span>
            </Button>
          );
        })
      )}
    </nav>
  );
}
