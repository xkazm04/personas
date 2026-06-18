import {
  isValidElement,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { WrapText, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { silentCatch } from '@/lib/silentCatch';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { useTranslation } from '@/i18n/useTranslation';


interface MarkdownRendererProps {
  content: string;
  className?: string;
  /**
   * Opt-in: render fenced code blocks with a header bar (language label +
   * copy button), the way Claude.ai / ChatGPT present code. Off by default
   * so the ~20 other MarkdownRenderer call sites stay bare; the Athena chat
   * passes it on.
   */
  codeBlockActions?: boolean;
}

/**
 * Flatten a React node tree to its text content. rehype-highlight replaces a
 * code block's plain-string child with an array of `<span class="hljs-…">`
 * tokens, so the copy button can't just read `children` as a string — it has
 * to walk the highlighted element tree.
 */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/** A fenced block taller than this collapses by default with an expander. */
const LONG_CODE_LINES = 16;

/**
 * Chrome for a fenced code block when `codeBlockActions` is on: a header bar
 * (language label + collapse toggle + line-wrap toggle + copy) over the code.
 * Per-block state: wrap toggles horizontal-scroll vs soft-wrap; long blocks
 * (> LONG_CODE_LINES) start collapsed under a height cap with a gradient
 * "show all N lines" strip, so a wall of code never dominates the transcript.
 */
function CodeBlockShell({
  lang,
  codeText,
  children,
}: {
  lang?: string;
  codeText: string;
  children: ReactNode;
}) {
  const { t, tx } = useTranslation();
  const [wrap, setWrap] = useState(false);
  const lineCount = useMemo(
    () => (codeText ? codeText.split('\n').length : 0),
    [codeText],
  );
  const collapsible = lineCount > LONG_CODE_LINES;
  const [collapsed, setCollapsed] = useState(true);
  const isCollapsed = collapsible && collapsed;

  return (
    <div className="my-3 rounded-xl border border-primary/10 bg-background/60 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-primary/10 bg-foreground/[0.03]">
        <span className="typo-caption font-mono lowercase tracking-wide text-primary/80">
          {lang}
        </span>
        <div className="flex items-center gap-0.5">
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-pressed={!collapsed}
              aria-label={collapsed ? t.shared.code_expand_block : t.shared.code_collapse_block}
              title={collapsed ? t.shared.code_expand_block : t.shared.code_collapse_block}
              className="p-1.5 rounded-lg text-foreground hover:text-foreground/80 hover:bg-secondary/50 transition-colors focus-ring"
              data-testid="companion-code-collapse-toggle"
            >
              {collapsed ? (
                <ChevronsUpDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronsDownUp className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            aria-label={t.shared.code_toggle_wrap}
            title={t.shared.code_toggle_wrap}
            className={`p-1.5 rounded-lg transition-colors focus-ring ${
              wrap
                ? 'text-primary bg-primary/10'
                : 'text-foreground hover:text-foreground/80 hover:bg-secondary/50'
            }`}
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          {codeText && <CopyButton text={codeText} iconSize="w-3.5 h-3.5" />}
        </div>
      </div>
      <div className={`relative ${isCollapsed ? 'max-h-72 overflow-hidden' : ''}`}>
        <pre className={`m-0 ${wrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto'}`}>
          {children}
        </pre>
        {isCollapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="absolute inset-x-0 bottom-0 flex items-end justify-center pt-10 pb-2 typo-caption font-medium text-primary hover:text-primary/80 bg-gradient-to-t from-background via-background/85 to-transparent focus-ring"
            data-testid="companion-code-expand"
          >
            {tx(t.shared.code_show_lines, { count: lineCount })}
          </button>
        )}
      </div>
    </div>
  );
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
    <div className="my-3 space-y-2 p-3.5 rounded-xl border border-primary/10 bg-secondary/20">
      {entries.map((e, i) => {
        const pct = (e.value / max) * 100;
        const isMax = e.value === max;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="typo-caption text-foreground w-28 truncate text-right">{e.label}</span>
            <div className="flex-1 h-6 rounded-md bg-foreground/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-md transition-all duration-500 ${
                  isMax
                    ? 'bg-gradient-to-r from-primary to-accent'
                    : 'bg-gradient-to-r from-primary/50 to-primary/75'
                }`}
                // Floor non-zero bars at 3% so small-but-present values stay visible.
                style={{ width: `${e.value > 0 ? Math.max(pct, 3) : 0}%` }}
              />
            </div>
            <span
              className={`typo-code w-14 text-right ${isMax ? 'text-primary font-semibold' : 'text-foreground'}`}
            >
              {e.value}
            </span>
          </div>
        );
      })}
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
    } catch (err) { silentCatch("features/shared/components/editors/MarkdownRenderer:catch1")(err); }
  }

  return cleaned;
}

function buildComponents(codeBlockActions: boolean): Components {
  return {
  // Generous top spacing on headings — markdown bodies read better when
  // each section is visually offset from the prior paragraph, not just
  // stacked tightly. Bottom margin stays moderate so the heading still
  // hugs its body.
  h1: ({ children }) => (
    <h1 className="typo-heading-lg text-primary mb-3 mt-10 first:mt-0 pb-1.5 border-b border-primary/20">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold text-primary/90 mb-2.5 mt-8 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="typo-heading text-accent mb-2 mt-6 first:mt-0 tracking-wide">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="typo-body text-foreground mb-3 leading-relaxed">{children}</p>
  ),
  // Forward the node's own className so remark-gfm's `contains-task-list` /
  // `task-list-item` markers survive (the chat scopes task-list styling off
  // them; the classes are inert on every other call site).
  ul: ({ className, children }) => (
    <ul className={`list-disc pl-5 space-y-1.5 mb-3 typo-body text-foreground${className ? ` ${className}` : ''}`}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1.5 mb-3 typo-body text-foreground">{children}</ol>
  ),
  li: ({ className, children }) => (
    <li className={`text-foreground${className ? ` ${className}` : ''}`}>{children}</li>
  ),
  code: ({ className, children, ...props }) => {
    const isChart = className?.includes('language-chart');
    if (isChart) {
      return <InlineBarChart raw={String(children).replace(/\n$/, '')} />;
    }
    const isBlock = className?.includes('language-');
    if (isBlock) {
      // With codeBlockActions the <pre> wrapper supplies the border/bg and
      // header bar, so the code element stays minimal; otherwise it carries
      // its own block chrome (unchanged for every non-chat call site).
      return codeBlockActions ? (
        <code className={`block p-4 typo-code ${className || ''}`} {...props}>
          {children}
        </code>
      ) : (
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
  pre: ({ children }) => {
    if (!codeBlockActions) return <pre className="mb-3">{children}</pre>;
    // Header bar: language label + wrap toggle + copy. Every fenced and
    // indented block is wrapped in <pre>, so owning the chrome here (not in
    // `code`) means even a no-language block still gets the header + a real
    // <pre>. The inner <code> element carries the language class and the
    // (highlight-tokenized) text in its props.
    const codeEl = isValidElement(children)
      ? (children as ReactElement<{ className?: string; children?: ReactNode }>)
      : null;
    const lang = /language-(\w+)/.exec(codeEl?.props?.className ?? '')?.[1];
    const codeText = extractText(codeEl?.props?.children).replace(/\n$/, '');
    return (
      <CodeBlockShell lang={lang} codeText={codeText}>
        {children}
      </CodeBlockShell>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-violet-500/30 pl-4 pr-3 py-2 italic text-foreground/90 my-3 bg-violet-500/5 rounded-r-lg">
      {children}
    </blockquote>
  ),
  // Tables — visible-but-subtle borders and a faint surface tint so the
  // grid reads as a discrete data block. `bg-foreground/[0.03]` is dark
  // in dark mode and light in light mode (the foreground token inverts
  // with the theme), so a single rule covers both.
  table: ({ children }) => (
    <table className="w-full typo-body my-4 border-separate border-spacing-0 overflow-hidden rounded-card border border-foreground/15 bg-foreground/[0.03]">
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th className="text-left typo-label text-foreground/85 px-3 py-2 border-b border-foreground/20 bg-foreground/[0.05]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-foreground/90 border-b border-foreground/10 last:border-b-0">
      {children}
    </td>
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
}

export function MarkdownRenderer({
  content,
  className,
  codeBlockActions = false,
}: MarkdownRendererProps) {
  const filtered = useMemo(() => filterMetaContent(content), [content]);
  const components = useMemo(
    () => buildComponents(codeBlockActions),
    [codeBlockActions],
  );

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
