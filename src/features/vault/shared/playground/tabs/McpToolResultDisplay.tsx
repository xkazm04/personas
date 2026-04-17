import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, AlertCircle, Clock, Check, Server } from 'lucide-react';
import type { McpToolResult } from '@/api/agents/mcpTools';

// -- Helpers ------------------------------------------------------

export function formatContent(text: string | null): string {
  if (!text) return '(empty)';
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return text;
  }
}

// -- Tool result display ------------------------------------------

export function ToolResultDisplay({ result }: { result: McpToolResult }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {/* Status line */}
      <div className="flex items-center gap-3">
        {result.is_error ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded typo-body font-medium bg-red-500/15 text-red-400 border border-red-500/25">
            <AlertCircle className="w-3 h-3" />
            {t.vault.playground.mcp_error}
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-1 rounded typo-body font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            <Check className="w-3 h-3" />
            {t.vault.playground.mcp_success}
          </span>
        )}
        <span className="flex items-center gap-1 typo-body text-foreground">
          <Clock className="w-3 h-3" />
          {result.duration_ms}ms
        </span>
      </div>

      {/* Content blocks */}
      {result.content.map((block, i) => (
        <div key={i} className="rounded-card border border-primary/8 overflow-hidden">
          {block.content_type !== 'text' && (
            <div className="px-3 py-1 typo-body text-foreground bg-secondary/20 border-b border-primary/5">
              {block.content_type}
            </div>
          )}
          <pre className="p-3 typo-code font-mono text-foreground whitespace-pre-wrap break-words overflow-auto max-h-[400px]">
            {formatContent(block.text)}
          </pre>
        </div>
      ))}
    </div>
  );
}

// -- Empty state --------------------------------------------------

export function EmptyState({ onDiscover }: { onDiscover: () => void }) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Server className="w-10 h-10 text-foreground" />
      <div className="text-center space-y-1">
        <p className="typo-body text-foreground">{sh.discover_mcp}</p>
        <p className="typo-body text-foreground">
          {sh.discover_mcp_hint}
        </p>
      </div>
      <button
        onClick={onDiscover}
        className="flex items-center gap-1.5 px-4 py-2 rounded-modal typo-body font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {sh.discover_tools}
      </button>
    </div>
  );
}
