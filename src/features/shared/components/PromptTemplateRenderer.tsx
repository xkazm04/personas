import { useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface PromptTemplateRendererProps {
  content: string;
  className?: string;
  maxHeight?: string;
}

/**
 * Renders a prompt template with markdown formatting and
 * {{variable}} placeholder highlighting via inline code styling.
 *
 * Reusable across all recipe views (overview, test runner, history, credential tab).
 */
export function PromptTemplateRenderer({
  content,
  className,
  maxHeight,
}: PromptTemplateRendererProps) {
  const processed = useMemo(() => {
    // Wrap {{variable}} placeholders in backticks so MarkdownRenderer
    // renders them as styled inline code (bg-primary/8, text-primary/70).
    // Negative lookbehind/ahead avoids double-wrapping already-backticked vars.
    return content.replace(/(?<!`)\{\{(\w+)\}\}(?!`)/g, '`{{$1}}`');
  }, [content]);

  return (
    <div
      className={`rounded-lg border border-border/40 bg-card/30 p-3 overflow-y-auto ${maxHeight ?? ''} ${className ?? ''}`}
    >
      <MarkdownRenderer content={processed} />
    </div>
  );
}
