import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { Check, Copy, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import Button from '@/features/shared/components/buttons/Button';


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
  if (start === 0) {
    // The unterminated fence is the very first content (e.g. a code-first
    // streaming reply) — there's nothing before it to keep, so slicing to
    // `start` would discard the whole streamed body. Preserve it and just
    // close the fence so the partial code renders incrementally.
    return content + '\n```';
  }
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
    const ok = await copyText(rawText);
    if (!ok) return;
    setCopied(true);
    addToast(t.agents.chat_thread.code_copied, 'success');
    setTimeout(() => setCopied(false), 1800);
  }, [rawText, addToast, t.agents.chat_thread.code_copied]);

  const showSendToLab = !!onSendToLab && (language ? LAB_ELIGIBLE_LANGUAGES.has(language) : false);

  return (
    <div className="relative group/code my-3">
      {language && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-t-card border border-b-0 border-primary/12 bg-surface-2">
          <span className="typo-label text-ink-1">
            {language}
          </span>
          <div className="flex items-center gap-1">
            {showSendToLab && (
              <Button
                type="button"
                onClick={() => onSendToLab?.(rawText, language)}
                tooltip={t.agents.chat_thread.send_to_lab}
                variant="ghost"
                size="xs"
                icon={<FlaskConical className="w-3 h-3" />}
              ><span>{t.agents.chat_thread.send_to_lab}</span></Button>
            )}
            <Button
              type="button"
              onClick={handleCopy}
              tooltip={t.agents.chat_thread.copy_code}
              aria-label={t.agents.chat_thread.copy_code}
              variant="ghost"
              size="xs"
              icon={copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
            ><span>{copied ? t.common.copied : t.common.copy}</span></Button>
          </div>
        </div>
      )}
      <pre
        className={`p-3 bg-background/60 border border-primary/12 ${language ? 'rounded-b-card' : 'rounded-card'} overflow-x-auto typo-code`}
      >
        {children}
      </pre>
      {!language && (
        <Button
          variant="ghost"
          size="icon-xs"
          tooltip={t.agents.chat_thread.copy_code}
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
          aria-label={t.agents.chat_thread.copy_code}
          icon={copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
        />
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
      <h1 className="typo-heading-lg text-ink-1 mb-2 mt-4 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="typo-heading text-ink-1 mb-2 mt-4 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="typo-heading text-ink-1 mb-1.5 mt-3 first:mt-0">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="typo-body text-ink-2 mb-2 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc pl-5 space-y-1 mb-2 typo-body text-ink-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal pl-5 space-y-1 mb-2 typo-body text-ink-1">{children}</ol>
    ),
    li: ({ children }) => <li className="text-ink-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-primary/30 pl-3 my-2 italic text-ink-1">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="w-full typo-body border-separate border-spacing-0 rounded-card border border-hair bg-surface-1">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="text-left typo-label text-ink-1 px-3 py-1.5 border-b border-hair-2 bg-surface-1">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 text-ink-1 border-b border-hair last:border-b-0">
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
    hr: () => <hr className="border-hair my-3" />,
    strong: ({ children }) => <strong className="font-semibold text-ink-1">{children}</strong>,
    em: ({ children }) => <em className="italic text-ink-1">{children}</em>,
    img: ({ src, alt }) => (
      <img src={src} alt={alt || ''} className="max-w-full h-auto rounded-card my-2 border border-hair" />
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
          className="inline-flex items-center typo-code text-primary/85"
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
