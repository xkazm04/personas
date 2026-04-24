import { X } from 'lucide-react';
import type { FlowNode } from '@/lib/types/frontendTypes';
import { NODE_TYPE_META, DEFAULT_NODE_META } from './activityDiagramTypes';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';

// ============================================================================
// Helpers
// ============================================================================

function tryParseJson(str: string): string {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return str;
  }
}

// ============================================================================
// Node Detail Popover
// ============================================================================

interface NodePopoverProps {
  node: FlowNode;
  onClose: () => void;
}

export default function NodePopover({ node, onClose }: NodePopoverProps) {
  const { t } = useTranslation();
  const typeMeta = NODE_TYPE_META[node.type] ?? DEFAULT_NODE_META;
  const TypeIcon = typeMeta.Icon;

  const requestData = node.request_data ? tryParseJson(node.request_data) : null;
  const responseData = node.response_data ? tryParseJson(node.response_data) : null;

  return (
    <div
      className={`bg-background/95 border border-primary/20 rounded-modal shadow-elevation-4 backdrop-blur-sm ${CARD_PADDING.standard} space-y-3 max-w-sm`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-card flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${typeMeta.color}20`, border: `1px solid ${typeMeta.color}40` }}
        >
          <TypeIcon className="w-3.5 h-3.5" style={{ color: typeMeta.color }} />
        </div>
        <span className="typo-code font-mono uppercase tracking-wider text-foreground">{typeMeta.label}</span>
        <button onClick={onClose} className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-secondary/60 transition-colors">
          <X className="w-3 h-3 text-foreground" />
        </button>
      </div>

      <div className="typo-body font-medium text-foreground/90">{node.label}</div>

      {node.detail && (
        <p className="typo-body text-foreground leading-relaxed">{node.detail}</p>
      )}

      {node.error_message && (
        <div className="px-3 py-2 rounded-modal bg-red-500/10 border border-red-500/15">
          <div className="typo-code font-mono uppercase tracking-wider text-red-400/60 mb-1">{t.templates.diagram.error_label}</div>
          <p className="typo-body text-red-400/90 leading-relaxed">{node.error_message}</p>
        </div>
      )}

      {requestData && (
        <div>
          <div className="typo-code font-mono uppercase tracking-wider text-blue-400/50 mb-1">{t.templates.diagram.request_label}</div>
          <pre className="typo-code text-blue-300/70 bg-blue-500/5 border border-blue-500/10 rounded-modal px-3 py-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
            {typeof requestData === 'string' ? requestData : JSON.stringify(requestData, null, 2)}
          </pre>
        </div>
      )}

      {responseData && (
        <div>
          <div className="typo-code font-mono uppercase tracking-wider text-emerald-400/50 mb-1">{t.templates.diagram.response_label}</div>
          <pre className="typo-code text-emerald-300/70 bg-emerald-500/5 border border-emerald-500/10 rounded-modal px-3 py-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
            {typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
