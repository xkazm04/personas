/**
 * Display sub-components for IdeaScannerPage:
 *   - LevelBadge        — effort/impact/risk numeric badge
 *   - AgentCard         — selectable scan-agent tile
 *   - ScanProgress      — in-progress scan progress bar
 *   - IdeaCard          — single idea result card
 *   - ScanHistoryTable  — past scan runs table
 */
import { motion } from 'framer-motion';
import { CheckSquare, Square, BarChart3, Clock, Info, RotateCcw, TrendingUp } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { SCAN_STATUS_STYLES, relativeTime } from './ideaScannerHelpers';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  SCAN_AGENTS, AGENT_CATEGORIES,
  type ScanAgentDef,
} from '../constants/scanAgents';
import {
  HEX_COLOR_MAP, DEFAULT_CATEGORY_TW, CATEGORY_TW, levelColor, levelSeverity,
} from '../constants/ideaColors';

// ---------------------------------------------------------------------------
// Types (shared with IdeaScannerPage)
// ---------------------------------------------------------------------------

export type CategoryKey = typeof AGENT_CATEGORIES[number]['key'];

export interface ScanIdea {
  id: string;
  title: string;
  description: string;
  category: CategoryKey;
  agentKey: string;
  effort: number;
  impact: number;
  risk: number;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function agentColor(agent: ScanAgentDef) {
  return HEX_COLOR_MAP[agent.color] ?? { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' };
}

// ---------------------------------------------------------------------------
// LevelBadge
// ---------------------------------------------------------------------------

export function LevelBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium border ${levelColor(value)}`}>
      {label}: {value}
      <span className="opacity-70">· {levelSeverity(value)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ValueBadge — synthesises effort/impact/risk into one glanceable verdict.
// Shared scorer (also drives the scanner + triage queue ordering): reward
// impact, charge for effort + risk.
// ---------------------------------------------------------------------------

export function ideaValueScore(i: { impact: number; effort: number; risk: number }): number {
  return i.impact * 2 - i.effort - i.risk;
}

function valueTier(score: number): 'high' | 'med' | 'low' {
  if (score >= 8) return 'high';
  if (score >= 1) return 'med';
  return 'low';
}

export function ValueBadge({ idea }: { idea: { impact: number; effort: number; risk: number } }) {
  const { t } = useTranslation();
  const ds = t.plugins.dev_scanner;
  const tier = valueTier(ideaValueScore(idea));
  const cfg = {
    high: { cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', label: ds.value_high },
    med: { cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10', label: ds.value_med },
    low: { cls: 'text-foreground border-primary/20 bg-primary/5', label: ds.value_low },
  }[tier];
  return (
    <Tooltip content={ds.value_tip} placement="top">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium border ${cfg.cls}`}
      >
        <TrendingUp className="w-3 h-3" />
        {cfg.label}
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

export function AgentCard({
  agent,
  selected,
  onToggle,
}: {
  agent: ScanAgentDef;
  selected: boolean;
  onToggle: () => void;
}) {
  const ac = agentColor(agent);
  const Icon = agent.icon;
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      title={agent.label}
      className={`group relative flex items-center justify-center h-14 px-7 rounded-card border overflow-hidden transition-colors ${
        selected
          ? 'bg-primary/10 border-primary/30 ring-1 ring-amber-500/30'
          : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
      }`}
    >
      {/* Background icon — semitransparent at rest, fully visible on hover */}
      <Icon
        className={`pointer-events-none absolute inset-0 m-auto w-12 h-12 ${ac.text} opacity-15 group-hover:opacity-90 transition-opacity duration-200`}
        strokeWidth={1.5}
        aria-hidden="true"
      />

      {/* Centered title */}
      <span className="relative z-10 typo-card-label text-foreground text-center leading-tight">
        {agent.label}
      </span>

      {/* Selection indicator — top-left */}
      <span className="absolute top-1.5 left-1.5 z-10">
        {selected ? (
          <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <Square className="w-3.5 h-3.5 text-foreground" />
        )}
      </span>

      {/* Help tooltip — top-right */}
      <span
        className="absolute top-1.5 right-1.5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content={agent.description} placement="top">
          <Info className="w-3.5 h-3.5 text-foreground hover:text-foreground transition-colors" />
        </Tooltip>
      </span>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// ScanProgress
// ---------------------------------------------------------------------------

export function ScanProgress({
  running,
  currentAgent,
  progress,
}: {
  running: boolean;
  currentAgent: ScanAgentDef | null;
  progress: number;
}) {
  const { t } = useTranslation();
  if (!running) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="border border-amber-500/20 bg-amber-500/5 rounded-modal p-4"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-7 h-7 rounded-card bg-amber-500/15 flex items-center justify-center text-md">
          {currentAgent?.emoji ?? '...'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-md font-medium text-foreground">
            {t.plugins.dev_scanner.scanning_with} {currentAgent?.label ?? '...'}
          </p>
          <p className="text-md text-foreground">
            {t.plugins.dev_scanner.analyzing_codebase}
          </p>
        </div>
        <span className="text-md text-amber-400 font-medium">{Math.round(progress)}%</span>
      </div>
      <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-amber-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// IdeaCard
// ---------------------------------------------------------------------------

export function IdeaCard({ idea, index }: { idea: ScanIdea; index: number }) {
  const { t } = useTranslation();
  const ds = t.plugins.dev_scanner;
  const { staggerDelay } = useMotion();
  const catTw = CATEGORY_TW[idea.category] ?? DEFAULT_CATEGORY_TW;
  const agent = SCAN_AGENTS.find((a) => a.key === idea.agentKey);
  const ac = agent ? agentColor(agent) : { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' };
  const catLabel = AGENT_CATEGORIES.find((c) => c.key === idea.category)?.label ?? idea.category;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * staggerDelay }}
      className="border border-primary/10 rounded-modal p-4 hover:bg-primary/5 hover:border-primary/20 transition-colors"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-7 h-7 rounded-card ${ac.bg} border ${ac.border} flex items-center justify-center text-md flex-shrink-0`}>
          {agent?.emoji ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-md font-medium text-foreground mb-0.5">{idea.title}</h4>
          <p className="text-md text-foreground line-clamp-2">{idea.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <ValueBadge idea={idea} />
        <span className={`rounded-full px-2.5 py-0.5 text-md font-medium ${catTw.bg} ${catTw.text} border ${catTw.border}`}>
          {catLabel}
        </span>
        <LevelBadge label={ds.level_effort} value={idea.effort} />
        <LevelBadge label={ds.level_impact} value={idea.impact} />
        <LevelBadge label={ds.level_risk} value={idea.risk} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ScanHistoryTable
// ---------------------------------------------------------------------------

export interface ScanHistoryEntry {
  id: string;
  agentTypes: string;
  ideaCount: number;
  timestamp: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}

export function ScanHistoryTable({
  history,
  onRerun,
}: {
  history: ScanHistoryEntry[];
  onRerun?: (agentKeys: string[]) => void;
}) {
  const { t } = useTranslation();
  const ds = t.plugins.dev_scanner;
  if (history.length === 0) {
    return <p className="text-md text-foreground">{ds.no_previous_scans}</p>;
  }
  const showRerun = Boolean(onRerun);
  const cols = showRerun
    ? 'grid-cols-[1fr_0.6fr_0.5fr_0.7fr_0.5fr_0.5fr_0.4fr]'
    : 'grid-cols-[1fr_0.6fr_0.5fr_0.7fr_0.5fr_0.5fr]';
  return (
    <div className="border border-primary/10 rounded-modal overflow-hidden">
      {/* Table header */}
      <div className={`grid ${cols} gap-2 px-3 py-2 bg-primary/5 border-b border-primary/10 text-md font-medium text-primary uppercase tracking-wider`}>
        <span>{ds.history_col_agents}</span>
        <span>{ds.history_col_status}</span>
        <span>{ds.history_col_ideas}</span>
        <span>{ds.history_col_tokens}</span>
        <span>{ds.history_col_duration}</span>
        <span>{ds.history_col_when}</span>
        {showRerun && <span className="text-right">{ds.history_col_action}</span>}
      </div>
      {history.map((entry) => {
        const agentKeys = entry.agentTypes.split(',').map((s) => s.trim()).filter(Boolean);
        const agentEmojis = agentKeys.map((k) => SCAN_AGENTS.find((a) => a.key === k)?.emoji ?? '?').join(' ');
        const statusStyle = SCAN_STATUS_STYLES[entry.status] ?? SCAN_STATUS_STYLES.error;
        const totalTokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
        return (
          <div key={entry.id} className={`grid ${cols} gap-2 px-3 py-2.5 border-b border-primary/5 last:border-b-0 hover:bg-primary/5 transition-colors items-center`}>
            <span className="text-md text-foreground truncate" title={agentKeys.join(', ')}>
              {agentEmojis} <span className="text-foreground">{agentKeys.length > 1 ? `(${agentKeys.length})` : agentKeys[0]}</span>
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-md font-medium border w-fit ${statusStyle}`}>
              {entry.status}
            </span>
            <span className="text-md text-foreground flex items-center gap-1">
              <BarChart3 className="w-3.5 h-3.5 text-foreground" />
              {entry.ideaCount}
            </span>
            <span className="text-md text-foreground font-mono">
              {totalTokens > 0 ? totalTokens.toLocaleString() : '-'}
            </span>
            <span className="text-md text-foreground">
              {formatDuration(entry.durationMs)}
            </span>
            <span className="text-md text-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {relativeTime(entry.timestamp)}
            </span>
            {showRerun && (
              <span className="text-right">
                <button
                  type="button"
                  onClick={() => onRerun!(agentKeys)}
                  title={ds.history_rerun_tooltip}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-[10px] font-medium text-foreground hover:border-primary/40 hover:bg-primary/10 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {ds.history_rerun_label}
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
