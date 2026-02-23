import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-foreground mb-3 mt-5 pb-1.5 border-b border-primary/10">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold text-foreground/85 mb-2.5 mt-4">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground/75 mb-2 mt-3 tracking-wide uppercase">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm text-foreground/90 mb-3 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-1.5 mb-3 text-sm text-foreground/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1.5 mb-3 text-sm text-foreground/90">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-foreground/90">{children}</li>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <code
          className={`block p-4 bg-background/60 border border-primary/10 rounded-xl text-sm font-mono overflow-x-auto ${className || ''}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1.5 py-0.5 bg-primary/8 border border-primary/12 rounded text-sm font-mono text-primary/70"
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
    <table className="w-full text-sm mb-3">{children}</table>
  ),
  th: ({ children }) => (
    <th className="text-left font-medium text-foreground/90 pb-2 border-b border-border/30">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-1.5 text-foreground/80 border-b border-border/20">{children}</td>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  hr: () => <hr className="border-border/30 my-4" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground/90">{children}</strong>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt || ''} className="max-w-full h-auto rounded-lg my-2 border border-border/20" />
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/80">{children}</em>
  ),
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
