/**
 * AssistantProse — how Athena's own words render in every chat surface.
 *
 * Three display passes over the already-stripped reply text, in order:
 *   1. the id net (`idNet`) shortens raw ids left in prose;
 *   2. ref links (`refGrammar`) become `RefLink`s via an `a` override;
 *   3. the safety-net fold (`replyFold`) tucks everything after the register's
 *      cap behind "Read the rest" (expanding is local state).
 *
 * The copy button and brain-link chips keep reading the ORIGINAL text — the
 * passes are for reading, not for what the operator copies.
 */

import { memo, useMemo, useState } from 'react';
import type { Components } from 'react-markdown';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { shortenBareIds } from './idNet';
import { RefLink } from './RefLink';
import { parseRefHref, rewriteRefHrefs } from './refGrammar';
import { foldAfterSentences } from './replyFold';
import { useReplyCap } from './useReplyCap';

/**
 * The `a` override. Non-ref links keep the renderer's default behaviour
 * (sanitized, new window) so overriding `a` costs nothing elsewhere.
 */
const REF_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const ref = parseRefHref(href);
    if (ref) {
      return (
        <RefLink kind={ref.kind} handle={ref.handle}>
          {children}
        </RefLink>
      );
    }
    const safeHref = sanitizeExternalUrl(href);
    if (!safeHref) return <span className="text-primary">{children}</span>;
    // The webview suppresses new windows, so an outbound link goes through the
    // one wired door (`open_external_url`), not target=_blank.
    return (
      <a
        href={safeHref}
        className="text-primary hover:underline"
        onClick={(e) => {
          e.preventDefault();
          openExternalUrl(safeHref).catch(silentCatch('companion_prose_open_external_url'));
        }}
      >
        {children}
      </a>
    );
  },
};

/** Id net + ref rewrite — the display form of a reply's markdown. */
export function prepareAssistantMarkdown(text: string): string {
  return rewriteRefHrefs(shortenBareIds(text));
}

export const AssistantProse = memo(function AssistantProse({
  content,
  fold = true,
  codeBlockActions = false,
  className = 'athena-chat-md',
}: {
  /** Reply text with model directives already stripped. */
  content: string;
  /** Apply the safety-net fold. Off while streaming and in previews. */
  fold?: boolean;
  codeBlockActions?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const cap = useReplyCap();
  const [expanded, setExpanded] = useState(false);
  const prepared = useMemo(() => prepareAssistantMarkdown(content), [content]);
  const folded = useMemo(
    () => (fold && !expanded ? foldAfterSentences(prepared, cap) : null),
    [fold, expanded, prepared, cap],
  );

  return (
    <>
      <MarkdownRenderer
        content={folded ? folded.head : prepared}
        className={className}
        codeBlockActions={codeBlockActions}
        components={REF_COMPONENTS}
      />
      {folded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="mt-1.5 typo-caption text-primary hover:underline underline-offset-2 rounded-interactive focus-ring"
          data-testid="companion-reply-read-rest"
        >
          {t.plugins.companion.reply_read_rest}
        </button>
      )}
    </>
  );
});
