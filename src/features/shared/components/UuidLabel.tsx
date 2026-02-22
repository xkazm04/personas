import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface UuidLabelProps {
  value: string;
  label?: string | null;
}

export function UuidLabel({ value, label }: UuidLabelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  const display = label || value.slice(0, 8);

  return (
    <span className="inline-flex items-center gap-1 group/uuid relative">
      <span
        className={`${label ? '' : 'font-mono '}text-foreground/80 cursor-default`}
        title={value}
      >
        {display}
        {!label && <span className="text-foreground/30">&hellip;</span>}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/uuid:opacity-100 p-0.5 rounded hover:bg-secondary/60 transition-opacity text-muted-foreground/80 hover:text-foreground/95"
        title="Copy full ID"
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </span>
  );
}
