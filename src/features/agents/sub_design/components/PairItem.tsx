import { Trash2, ArrowRight, FileInput, FileOutput } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ExamplePair } from '../wizard/ExamplePairCollector';

interface PairItemProps {
  pair: ExamplePair;
  index: number;
  isCollapsed: boolean;
  disabled: boolean;
  onToggleCollapse: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: 'input' | 'output', value: string) => void;
}

export function PairItem({ pair, index, isCollapsed, disabled, onToggleCollapse, onRemove, onUpdate }: PairItemProps) {
  const hasContent = pair.input.trim() || pair.output.trim();
  const preview = hasContent
    ? (pair.input.trim().slice(0, 40) || '(no input)') + ' -> ' + (pair.output.trim().slice(0, 40) || '(no output)')
    : null;

  return (
    <motion.div
      key={pair.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.02] overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => onToggleCollapse(pair.id)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          <span className="text-xs font-semibold text-emerald-400/80 uppercase tracking-wider">Example {index + 1}</span>
          {isCollapsed && preview && <span className="text-xs text-muted-foreground/50 truncate ml-1">{preview}</span>}
        </button>
        <button onClick={() => onRemove(pair.id)} disabled={disabled} className="p-0.5 text-muted-foreground/40 hover:text-red-400 transition-colors" title="Remove example">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {!isCollapsed && (
        <div className="px-3 pb-3 space-y-2">
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground/70">
              <FileInput className="w-3 h-3" />
              Input -- what the agent receives
            </label>
            <textarea
              value={pair.input}
              onChange={(e) => onUpdate(pair.id, 'input', e.target.value)}
              disabled={disabled}
              placeholder={'Paste a real input...\n\ne.g. an email body, a Slack message, a webhook JSON payload, a CSV row'}
              rows={4}
              className="w-full bg-background/50 border border-emerald-500/10 rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
            />
          </div>
          <div className="flex justify-center">
            <ArrowRight className="w-4 h-4 text-emerald-500/40 rotate-90" />
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground/70">
              <FileOutput className="w-3 h-3" />
              Output -- what you want the agent to produce
            </label>
            <textarea
              value={pair.output}
              onChange={(e) => onUpdate(pair.id, 'output', e.target.value)}
              disabled={disabled}
              placeholder={'Describe or paste the desired output...\n\ne.g. "Create a Jira ticket with title from subject, priority P2, assigned to backend team"'}
              rows={4}
              className="w-full bg-background/50 border border-emerald-500/10 rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
