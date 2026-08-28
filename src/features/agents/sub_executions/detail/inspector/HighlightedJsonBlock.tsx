import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import jsonLang from 'highlight.js/lib/languages/json';
import { AlertTriangle } from 'lucide-react';
import { sanitizeHljsHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { useTranslation } from '@/i18n/useTranslation';

hljs.registerLanguage('json', jsonLang);

const PRE_BASE = 'p-4 bg-background/50 border border-border/30 rounded-modal typo-code overflow-x-auto';

/**
 * Payload viewer for span/execution input & output.
 *
 * A payload that does not parse is still shown raw — but it is LABELLED as
 * unparseable, with the parser's own reason. Falling back silently made a
 * corrupt payload indistinguishable from a viewer correctly displaying plain
 * text, which is the exact moment this component is worth the most.
 */
export function HighlightedJsonBlock({ raw }: { raw: string | null }) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  const { html, parseError } = useMemo(() => {
    if (!raw) return { html: null, parseError: null };
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return {
        html: sanitizeHljsHtml(hljs.highlight(pretty, { language: 'json' }).value),
        parseError: null,
      };
    } catch (err) {
      // Not an error door: a non-JSON payload is an ordinary case here. The
      // reason travels to the UI instead of being swallowed.
      return { html: null, parseError: err instanceof Error ? err.message : String(err) };
    }
  }, [raw]);

  return (
    <div className="space-y-1">
      {parseError && (
        <div className="flex items-start gap-1.5 typo-code text-amber-400">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="break-words min-w-0">{tx(e.payload_not_parseable, { reason: parseError })}</span>
        </div>
      )}
      <div className="relative group">
        {html ? (
          <pre
            className={`json-highlight ${PRE_BASE}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className={`${PRE_BASE} text-foreground/90`}>{raw ?? ''}</pre>
        )}
        {raw && (
          <CopyButton
            text={raw}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          />
        )}
      </div>
    </div>
  );
}
