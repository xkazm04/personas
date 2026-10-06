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
    <div ref={reader.scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" data-p2-scroll={item.id} data-testid="p2-reader">
      <div
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-primary/10 bg-background px-6"
        style={{ height: READER_CHROME_OFFSET }}
      >
        <span className="min-w-0 flex-1 truncate typo-caption">
          {isHtml ? 'HTML document' : section ?? 'Start'}
        </span>
        <span className="typo-data tabular-nums text-foreground">{formatPercent(reader.progress, { fromRatio: true, precision: 0 })}</span>
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/10" aria-hidden>
          <motion.span
            className="block h-full origin-left bg-primary"
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
    <nav className="flex flex-col gap-1 pt-4" aria-label="Contents" data-testid="p2-contents">
      <span className="typo-label">Contents</span>
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
              className={`w-full min-w-0 justify-start! rounded-input text-left [&>span]:block [&>span]:min-w-0 [&>span]:truncate ${h.level === 1 ? '' : h.level === 2 ? 'pl-4' : 'pl-7'} ${on ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
            >
              <span className="truncate typo-caption text-current">{h.text}</span>
            </Button>
          );
        })
      )}
    </nav>
  );
}
