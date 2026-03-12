import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import jsonLang from 'highlight.js/lib/languages/json';
import { sanitizeHljsHtml } from '@/lib/utils/sanitizers/sanitizeHtml';

hljs.registerLanguage('json', jsonLang);

export function HighlightedJsonBlock({ raw }: { raw: string | null }) {
  const html = useMemo(() => {
    if (!raw) return null;
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return sanitizeHljsHtml(hljs.highlight(pretty, { language: 'json' }).value);
    } catch { // intentional: non-critical -- JSON parse fallback
      return null;
    }
  }, [raw]);

  if (!html) {
    return (
      <pre className="p-4 bg-background/50 border border-border/30 rounded-xl text-sm text-foreground/90 overflow-x-auto font-mono">
        {raw ?? ''}
      </pre>
    );
  }

  return (
    <pre
      className="json-highlight p-4 bg-background/50 border border-border/30 rounded-xl text-sm overflow-x-auto font-mono"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
