import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  ChevronDown,
  ChevronRight,
  Clock,
  Wrench,
  Webhook,
  Zap,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/utils/connector-meta';
import type { DesignAnalysisResult, SuggestedTrigger, SuggestedConnector } from '@/lib/types/designTypes';

interface ConnectorRow {
  connector: SuggestedConnector | null;
  tools: string[];
  triggerIndices: number[];
}

function triggerIcon(type: SuggestedTrigger['trigger_type']) {
  switch (type) {
    case 'schedule':
    case 'polling':
      return <Clock className="w-4 h-4 text-amber-400" />;
    case 'webhook':
      return <Webhook className="w-4 h-4 text-blue-400" />;
    case 'manual':
      return <Play className="w-4 h-4 text-emerald-400" />;
    default:
      return <Zap className="w-4 h-4 text-purple-400" />;
  }
}

function TemplateConnectorCard({
  row,
  designResult,
}: {
  row: ConnectorRow;
  designResult: DesignAnalysisResult;
}) {
  const [expanded, setExpanded] = useState(false);

  const connector = row.connector;
  const connectorName = connector?.name ?? 'general';
  const meta = getConnectorMeta(connectorName);

  const toolCount = row.tools.length;
  const triggerCount = row.triggerIndices.length;

  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left hover:bg-primary/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        )}
        {connector ? (
          <div
            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${meta.color}20` }}
          >
            <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
          </div>
        ) : (
          <Wrench className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground/80 truncate flex-1">
          {connector ? meta.label : 'General'}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {toolCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/60 text-xs text-foreground/50">
              <Wrench className="w-3 h-3 text-primary/50" />
              {toolCount}
            </span>
          )}
          {triggerCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/60 text-xs text-foreground/50">
              <Zap className="w-3 h-3 text-amber-400/60" />
              {triggerCount}
            </span>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3.5 py-2.5 space-y-2 border-t border-primary/[0.08]">
              {row.tools.map((toolName) => (
                <div key={toolName} className="flex items-start gap-2">
                  <Wrench className="w-3.5 h-3.5 text-primary/40 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-foreground/70 truncate">{toolName}</span>
                </div>
              ))}

              {row.triggerIndices.map((trigIdx) => {
                const trigger = designResult.suggested_triggers[trigIdx];
                if (!trigger) return null;
                return (
                  <div key={trigIdx} className="flex items-start gap-2">
                    <div className="flex-shrink-0 mt-0.5">{triggerIcon(trigger.trigger_type)}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground/70 capitalize truncate block">
                        {trigger.trigger_type}
                      </span>
                      <span className="text-sm text-muted-foreground/40 leading-snug block">
                        {trigger.description}
                      </span>
                    </div>
                  </div>
                );
              })}

              {toolCount === 0 && triggerCount === 0 && (
                <div className="text-sm text-muted-foreground/20 py-1">&mdash;</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TemplateConnectorGrid({
  designResult,
}: {
  designResult: DesignAnalysisResult;
}) {
  const suggestedConnectors = designResult.suggested_connectors ?? [];

  const rows = useMemo<ConnectorRow[]>(() => {
    const linkedTools = new Set<string>();
    const linkedTriggers = new Set<number>();
    const connectorRows: ConnectorRow[] = [];

    for (const conn of suggestedConnectors) {
      const tools = (conn.related_tools ?? []).filter((t) => designResult.suggested_tools.includes(t));
      const triggerIdxs = (conn.related_triggers ?? []).filter(
        (i) => i >= 0 && i < designResult.suggested_triggers.length
      );

      tools.forEach((t) => linkedTools.add(t));
      triggerIdxs.forEach((i) => linkedTriggers.add(i));

      connectorRows.push({ connector: conn, tools, triggerIndices: triggerIdxs });
    }

    const unlinkedTools = designResult.suggested_tools.filter((t) => !linkedTools.has(t));
    const unlinkedTriggers = designResult.suggested_triggers
      .map((_, i) => i)
      .filter((i) => !linkedTriggers.has(i));

    if (unlinkedTools.length > 0 || unlinkedTriggers.length > 0) {
      connectorRows.push({ connector: null, tools: unlinkedTools, triggerIndices: unlinkedTriggers });
    }

    return connectorRows;
  }, [suggestedConnectors, designResult.suggested_tools, designResult.suggested_triggers]);

  if (rows.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wide mb-2">
        Connectors &amp; Configuration
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map((row, rowIdx) => (
          <TemplateConnectorCard
            key={rowIdx}
            row={row}
            designResult={designResult}
          />
        ))}
      </div>
    </div>
  );
}
