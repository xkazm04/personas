/**
 * report / council — the long-form reader. A slim rail (what saying yes does,
 * contents with the current section lit, facts) beside the document, a reading
 * progress hairline over it. Markdown renders through MarkdownRenderer
 * `document`; HTML through HtmlDocumentFrame (sandboxed, grows to its own
 * height inside the reader's scroll; its headings are not reachable from the
 * parent, so the rail shows the format note instead of contents).
 */
import type { RefObject } from 'react';
import { motion } from 'framer-motion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { HtmlDocumentFrame } from '@/features/shared/components/document/HtmlDocumentFrame';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { DecisionItem } from '../../../model/decisionModel';
import { Block, Consequence } from './BodyParts';
import { COPY } from './copy';
import { useReader } from './useReader';

export function ReportBody({ item, scrollRef }: { item: DecisionItem; scrollRef: RefObject<HTMLDivElement | null> }) {
  const doc = item.document;
  const html = doc?.format === 'html';
  const reader = useReader(scrollRef, item.id);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] border-t p1-hair">
      <aside className="min-h-0 space-y-5 overflow-y-auto border-r p1-hair p1-band px-4 py-4">
        <Consequence item={item} />
        {html ? (
          <Block label={COPY.sheet.format}>
            <p className="typo-caption">{COPY.sheet.htmlNote}</p>
          </Block>
        ) : (
          <Block label={COPY.sheet.contents} aside={<span className="typo-caption"><Numeric value={reader.progress} unit="ratio" precision={0} /> {COPY.sheet.progress}</span>}>
            <nav aria-label={COPY.sheet.contents} className="flex flex-col">
              {reader.headings.map((h) => (
                <Button
                  key={h.id}
                  variant="ghost"
                  size="sm"
                  aria-current={reader.active === h.id ? 'true' : undefined}
                  onClick={() => reader.jump(h.id)}
                  className={`p1-toc-item w-full rounded-none text-left ${h.level > 1 ? 'pl-5' : ''}`}
                >
                  <span className="typo-label">{h.text}</span>
                </Button>
              ))}
            </nav>
          </Block>
        )}
      </aside>
      <div className="relative flex min-h-0 flex-col">
        <div className="p1-progress shrink-0" aria-hidden>
          <motion.span initial={false} animate={{ scaleX: reader.progress }} transition={{ duration: 0.12 }} />
        </div>
        {/* One scroll region for both formats: the frame grows to its document's
            height, so ↑/↓, the progress hairline and the footer all behave alike. */}
        <div ref={scrollRef} className="p1-doc min-h-0 flex-1 overflow-y-auto px-10 py-6" tabIndex={0} aria-label={item.title}>
          {html ? (
            <div className="mx-auto max-w-[58rem] overflow-hidden rounded-card border p1-hair">
              <HtmlDocumentFrame html={doc?.content ?? ''} title={item.title} />
            </div>
          ) : (
            <div className="mx-auto max-w-[44rem]">
              <MarkdownRenderer content={doc?.content ?? item.body} variant="document" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
