import { useState, useCallback, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import {
  Check,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useTranslation } from '@/i18n/useTranslation';

// -- Copy button -------------------------------------------------

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // intentional: non-critical -- clipboard access denied
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title={t.vault.design_phases.copy_to_clipboard}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm transition-all ${
        copied
          ? 'text-emerald-400 bg-emerald-500/10'
          : 'text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/60'
      } ${className ?? ''}`}
    >
      {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// -- Custom markdown components with copy/link enhancements ------

export function buildComponents(onOpenUrl: (url: string) => void): Components {
  return {
    code: ({ className, children, ...props }) => {
      const text = extractText(children);
      const isBlock = className?.includes('language-');
      if (isBlock) {
        return (
          <div className="relative group my-2">
            <code
              className={`block p-3 bg-background/60 border border-primary/10 rounded-lg text-sm font-mono overflow-x-auto ${className || ''}`}
              {...props}
            >
              {children}
            </code>
            {text.trim() && (
              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={text.trim()} />
              </div>
            )}
          </div>
        );
      }
      return (
        <span className="inline-flex items-center gap-0.5">
          <code
            className="px-1.5 py-0.5 bg-secondary/60 border border-primary/10 rounded text-sm font-mono text-amber-300"
            {...props}
          >
            {children}
          </code>
          {text.trim().length > 4 && (
            <CopyButton text={text.trim()} className="ml-0.5" />
          )}
        </span>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-2">{children}</pre>
    ),
    a: ({ href, children }) => {
      const url = href || '';
      const safeUrl = sanitizeExternalUrl(url);
      return (
        <span className="inline-flex items-center gap-1">
          <button
            onClick={safeUrl ? () => onOpenUrl(safeUrl) : undefined}
            disabled={!safeUrl}
            className={`text-left inline-flex items-center gap-1 ${
              safeUrl ? 'text-primary hover:underline' : 'text-muted-foreground/50 cursor-not-allowed'
            }`}
          >
            {children}
            <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
          </button>
          {safeUrl && <CopyButton text={safeUrl} />}
        </span>
      );
    },
    p: ({ children }) => (
      <p className="text-sm text-foreground/80 my-1 leading-relaxed">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside space-y-0.5 my-1 text-sm text-foreground/80">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside space-y-0.5 my-1 text-sm text-foreground/80">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-foreground/80">{children}</li>
    ),
    h1: ({ children }) => (
      <h1 className="text-sm font-bold text-foreground mb-1.5 mt-2">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-sm font-semibold text-foreground/90 mb-1 mt-2">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/80 mb-1 mt-1.5">{children}</h3>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    hr: () => <hr className="border-primary/10 my-2" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-primary/20 pl-3 italic text-foreground/90 my-2 text-sm">
        {children}
      </blockquote>
    ),
  };
}

/** Extract plain text from React children. */
export function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}
