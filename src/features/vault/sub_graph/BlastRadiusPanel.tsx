import { motion } from 'framer-motion';
import { Key, Bot, Zap, X, Shield } from 'lucide-react';
import type { BlastRadius } from './credentialGraph';
import { SEVERITY_STYLES } from './graphConstants';

interface BlastRadiusPanelProps {
  blast: BlastRadius;
  onClose: () => void;
}

export function BlastRadiusPanel({ blast, onClose }: BlastRadiusPanelProps) {
  const sev = SEVERITY_STYLES[blast.severity];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground/85">Blast Radius</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Credential name + severity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-sm font-medium text-foreground/80">{blast.credentialName}</span>
          </div>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-lg border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>

        {/* Impact summary */}
        <div className="text-xs text-muted-foreground/70 leading-relaxed">
          {blast.severity === 'high' ? (
            <span>Removing this credential would impact <strong className="text-red-400">{blast.affectedAgents.length} agents</strong>. Consider rotating instead of deleting.</span>
          ) : blast.severity === 'medium' ? (
            <span>This credential is used by <strong className="text-amber-400">{blast.affectedAgents.length} agent{blast.affectedAgents.length !== 1 ? 's' : ''}</strong>. Review dependencies before changes.</span>
          ) : (
            <span>No agents depend on this credential. Safe to modify or remove.</span>
          )}
        </div>

        {/* Affected agents */}
        {blast.affectedAgents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">Affected Agents</div>
            <div className="space-y-1">
              {blast.affectedAgents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                  <Bot className="w-3 h-3 text-blue-400/60" />
                  <span className="text-xs text-foreground/80 flex-1 truncate">{agent.name}</span>
                  {agent.via && (
                    <span className="text-xs text-muted-foreground/60 font-mono">{agent.via}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Affected events */}
        {blast.affectedEvents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">Affected Events</div>
            <div className="space-y-1">
              {blast.affectedEvents.map((evt) => (
                <div key={evt.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                  <Zap className="w-3 h-3 text-amber-400/60" />
                  <span className="text-xs text-foreground/80 truncate">{evt.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
