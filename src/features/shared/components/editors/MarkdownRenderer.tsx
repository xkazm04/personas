import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/** Inline bar chart for ```chart code blocks. Expects label:value lines. */
function InlineBarChart({ raw }: { raw: string }) {
  const entries = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, ...rest] = l.split(':');
      const val = parseFloat(rest.join(':').trim());
      return { label: label?.trim() ?? '', value: isNaN(val) ? 0 : val };
    })
    .filter((e) => e.label);
  const max = Math.max(...entries.map((e) => e.value), 1);

  if (entries.length === 0) return <pre className="typo-code text-foreground">{raw}</pre>;

  return (
    <div className="my-3 space-y-1.5 p-3 rounded-xl border border-primary/10 bg-secondary/20">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-foreground w-28 truncate text-right">{e.label}</span>
          <div className="flex-1 h-5 rounded bg-primary/[0.06] overflow-hidden">
            <div
              className="h-full rounded bg-gradient-to-r from-primary/40 to-primary/60 transition-all"
              style={{ width: `${(e.value / max) * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono text-foreground w-14 text-right">{e.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Strip <thinking>, [META], and similar meta-information blocks from content.
 *  Also normalize raw content for consistent rendering. */
function filterMetaContent(content: string): string {
  let cleaned = content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/\[META\][\s\S]*?\[\/META\]/gi, '')
    .replace(/---\s*meta\s*---[\s\S]*?---\s*end\s*meta\s*---/gi, '')
    .trim();

  // If the entire content looks like a JSON object/array and isn't already in a code fence, wrap it
  if (/^\s*[[{]/.test(cleaned) && /[\]}]\s*$/.test(cleaned) && !cleaned.includes('```')) {
    try {
      const parsed = JSON.parse(cleaned);
      cleaned = '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
    } catch {
      // Not valid JSON, leave as-is
    }
  }

  return cleaned;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="typo-heading-lg text-primary mb-3 mt-6 pb-1.5 border-b border-primary/20">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold text-primary/90 mb-2.5 mt-4">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="typo-heading text-accent mb-2 mt-3 tracking-wide">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="typo-body text-foreground/90 mb-3 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-1.5 mb-3 typo-body text-foreground/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1.5 mb-3 typo-body text-foreground/90">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-foreground/90">{children}</li>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes('language-');
    const isChart = className?.includes('language-chart');
    if (isChart) {
      return <InlineBarChart raw={String(children).replace(/\n$/, '')} />;
    }
    if (isBlock) {
      return (
        <code
          className={`block p-4 bg-background/60 border border-primary/10 rounded-xl typo-code overflow-x-auto ${className || ''}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1.5 py-0.5 bg-primary/8 border border-primary/12 rounded typo-code text-primary/70"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-violet-500/30 pl-4 pr-3 py-2 italic text-foreground/90 my-3 bg-violet-500/5 rounded-r-lg">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <table className="w-full typo-body mb-3">{children}</table>
  ),
  th: ({ children }) => (
    <th className="text-left font-medium text-foreground/90 pb-2 border-b border-border/30">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-1.5 text-foreground border-b border-border/20">{children}</td>
  ),
  a: ({ href, children }) => {
    const safeHref = sanitizeExternalUrl(href);
    if (!safeHref) return <span className="text-primary">{children}</span>;
    return (
      <a href={safeHref} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  hr: () => <hr className="border-border/30 my-4" />,
  strong: ({ children }) => (
    <strong className="font-bold text-foreground">{children}</strong>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt || ''} className="max-w-full h-auto rounded-lg my-2 border border-border/20" />
  ),
  em: ({ children }) => (
    <em className="italic text-foreground">{children}</em>
  ),
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const filtered = useMemo(() => filterMetaContent(content), [content]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {filtered}
      </ReactMarkdown>
    </div>
  );
}
