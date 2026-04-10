import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Tooltip } from './Tooltip';

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
      <Tooltip content={value}>
        <span
          className={`${label ? '' : 'font-mono '}text-foreground cursor-default`}
        >
          {display}
          {!label && <span className="text-foreground/90">&hellip;</span>}
        </span>
      </Tooltip>
      <Tooltip content="Copy full ID">
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover/uuid:opacity-100 p-0.5 rounded hover:bg-secondary/60 transition-opacity text-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </Tooltip>
    </span>
  );
}
