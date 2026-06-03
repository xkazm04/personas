import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { Check, Copy, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { silentCatch } from '@/lib/silentCatch';


interface ChatMessageContentProps {
  content: string;
  streaming?: boolean;
  onSendToLab?: (code: string, language?: string) => void;
  className?: string;
}

const LAB_ELIGIBLE_LANGUAGES = new Set([
  'sh', 'shell', 'bash', 'zsh', 'powershell', 'ps1', 'json',
]);

// Strip an unterminated trailing code fence so streaming output never
// renders a half-parsed block (which would flash as raw markdown text).
// Keeps everything up to the last ``` open marker; the partial body is
// shown as a fenced placeholder until the closing fence arrives.
function makeStreamSafe(content: string): string {
  const fenceCount = (content.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 0) return content;
  const lastFence = content.lastIndexOf('\n```');
  const start = lastFence === -1 ? content.indexOf('```') : lastFence + 1;
  if (start === -1) return content;
  return content.slice(0, start) + '```\n```';
}

function extractCodeText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props?.children !== undefined) return extractCodeText(props.children);
  }
  return '';
}

function CodeBlock({
  language,
  rawText,
  onSendToLab,
  children,
}: {
  language: string | null;
  rawText: string;
  onSendToLab?: (code: string, language?: string) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      addToast(t.agents.chat_thread.code_copied, 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch (err) { silentCatch("features/agents/components/ChatMessageContent:catch1")(err); }
  }, [rawText, addToast, t.agents.chat_thread.code_copied]);

  const showSendToLab = !!onSendToLab && (language ? LAB_ELIGIBLE_LANGUAGES.has(language) : false);

  return (
    <div className="relative group/code my-3">
      {language && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-t-card border border-b-0 border-primary/12 bg-secondary/40">
          <span className="typo-label text-foreground uppercase tracking-wide">
            {language}
          </span>
          <div className="flex items-center gap-1">
            {showSendToLab && (
              <button
                type="button"
                onClick={() => onSendToLab?.(rawText, language)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-foreground hover:text-primary hover:bg-primary/8 typo-label transition-colors"
                title={t.agents.chat_thread.send_to_lab}
              >
                <FlaskConical className="w-3 h-3" />
                <span>{t.agents.chat_thread.send_to_lab}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-foreground hover:text-foreground hover:bg-foreground/5 typo-label transition-colors"
              title={t.agents.chat_thread.copy_code}
              aria-label={t.agents.chat_thread.copy_code}
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? t.common.copied : t.common.copy}</span>
            </button>
          </div>
        </div>
      )}
      <pre
        className={`p-3 bg-background/60 border border-primary/12 ${language ? 'rounded-b-card' : 'rounded-card'} overflow-x-auto typo-code`}
      >
        {children}
      </pre>
      {!language && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 p-1 rounded text-foreground opacity-0 group-hover/code:opacity-100 hover:text-foreground hover:bg-foreground/5 transition-all"
          title={t.agents.chat_thread.copy_code}
          aria-label={t.agents.chat_thread.copy_code}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

export function ChatMessageContent({
  content,
  streaming,
  onSendToLab,
  className,
}: ChatMessageContentProps) {
  const safeContent = useMemo(
    () => (streaming ? makeStreamSafe(content) : content),
    [content, streaming],
  );

  const components: Components = useMemo(() => ({
    h1: ({ children }) => (
      <h1 className="typo-heading-lg text-foreground mb-2 mt-4 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="typo-heading text-foreground mb-2 mt-4 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="typo-heading text-foreground/90 mb-1.5 mt-3 first:mt-0">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="typo-body text-foreground mb-2 last:mb-0 leading-relaxed">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc pl-5 space-y-1 mb-2 typo-body text-foreground">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal pl-5 space-y-1 mb-2 typo-body text-foreground">{children}</ol>
    ),
    li: ({ children }) => <li className="text-foreground">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-primary/30 pl-3 my-2 italic text-foreground">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="w-full typo-body border-separate border-spacing-0 rounded-card border border-foreground/15 bg-foreground/[0.03]">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="text-left typo-label text-foreground/85 px-3 py-1.5 border-b border-foreground/20 bg-foreground/[0.05]">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 text-foreground/90 border-b border-foreground/10 last:border-b-0">
        {children}
      </td>
    ),
    a: ({ href, children }) => {
      const safeHref = sanitizeExternalUrl(href);
      if (!safeHref) return <span className="text-primary">{children}</span>;
      return (
        <a
          href={safeHref}
          className="text-primary hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    hr: () => <hr className="border-primary/15 my-3" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic text-foreground">{children}</em>,
    img: ({ src, alt }) => (
      <img src={src} alt={alt || ''} className="max-w-full h-auto rounded-card my-2 border border-primary/10" />
    ),
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const codeProps = (child as { props?: { className?: string; children?: unknown } } | undefined)?.props;
      const className = codeProps?.className ?? '';
      const langMatch = /language-([\w+-]+)/.exec(className);
      const language: string | null = langMatch?.[1] ?? null;
      const rawText = extractCodeText(codeProps?.children).replace(/\n$/, '');
      return (
        <CodeBlock language={language} rawText={rawText} onSendToLab={onSendToLab}>
          {children}
        </CodeBlock>
      );
    },
    code: ({ className, children, ...props }) => {
      const isBlock = className?.includes('language-');
      if (isBlock) {
        return (
          <code className={`block ${className || ''}`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code
          className="px-1.5 py-0.5 bg-primary/10 border border-primary/15 rounded typo-code text-primary/85"
          {...props}
        >
          {children}
        </code>
      );
    },
  }), [onSendToLab]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {safeContent}
      </ReactMarkdown>
      {streaming && (
        <span
          aria-hidden="true"
          className="inline-block w-[2px] h-[1.05em] align-text-bottom ml-0.5 bg-primary/70 animate-[blink-caret_1s_step-end_infinite]"
        />
      )}
    </div>
  );
}
