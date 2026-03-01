import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, AlertTriangle, Wrench, Zap, Link, Clock, ExternalLink, Cpu } from 'lucide-react';
import { TEAM_ROLES, PersonaAvatar } from '@/features/pipeline/sub_canvas/teamConstants';
import { usePersonaStore } from '@/stores/personaStore';
import { extractConnectorNames } from '@/lib/personas/utils';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface TeamConfigPanelProps {
  member: {
    id: string;
    persona_id?: string;
    persona_name?: string;
    name?: string;
    persona_icon?: string;
    icon?: string;
    persona_color?: string;
    color?: string;
    role?: string;
  };
  onClose: () => void;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
}

/** Extract tool count from design result JSON */
function extractToolCount(designResult: string | null): number {
  if (!designResult) return 0;
  try {
    const dr = JSON.parse(designResult) as DesignAnalysisResult;
    return dr.suggested_tools?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Format a relative time string from an ISO timestamp */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TeamConfigPanel({ member, onClose, onRoleChange, onRemove }: TeamConfigPanelProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  const personas = usePersonaStore((s) => s.personas);
  const personaTriggerCounts = usePersonaStore((s) => s.personaTriggerCounts);
  const personaLastRun = usePersonaStore((s) => s.personaLastRun);
  const personaHealthMap = usePersonaStore((s) => s.personaHealthMap);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  if (!member) return null;

  const personaName = member.persona_name || member.name || 'Agent';
  const personaIcon = member.persona_icon || member.icon || '';
  const personaColor = member.persona_color || member.color || '#6366f1';

  // Look up the full persona record for stats
  const persona = useMemo(
    () => (member.persona_id ? personas.find((p) => p.id === member.persona_id) : undefined),
    [member.persona_id, personas],
  );

  const stats = useMemo(() => {
    if (!persona) return null;
    const triggerCount = personaTriggerCounts[persona.id] ?? 0;
    const lastRun = personaLastRun[persona.id] ?? null;
    const health = personaHealthMap[persona.id];
    const toolCount = extractToolCount(persona.last_design_result);
    const connectors = extractConnectorNames(persona);
    const model = persona.model_profile || 'default';

    return { triggerCount, lastRun, health, toolCount, connectorCount: connectors.length, model };
  }, [persona, personaTriggerCounts, personaLastRun, personaHealthMap]);

  const handleViewPersona = () => {
    if (!member.persona_id) return;
    selectPersona(member.persona_id);
    setSidebarSection('personas');
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="absolute top-0 right-0 bottom-0 w-72 bg-background/95 backdrop-blur-md border-l border-primary/15 z-20 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <span className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Configure</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Persona Info */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 border border-primary/10">
            <PersonaAvatar icon={personaIcon} color={personaColor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground/90 truncate">{personaName}</div>
              <div className="text-[11px] text-muted-foreground/60 font-mono truncate">{member.id?.slice(0, 8)}...</div>
            </div>
            {member.persona_id && (
              <button
                onClick={handleViewPersona}
                title="View persona"
                className="p-1.5 rounded-lg hover:bg-secondary/70 text-muted-foreground/50 hover:text-foreground/80 transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Persona Stats */}
          {stats && (
            <div className="grid grid-cols-2 gap-1.5">
              <StatPill icon={Cpu} label="Model" value={stats.model} color={personaColor} />
              <StatPill icon={Wrench} label="Tools" value={String(stats.toolCount)} color="#3b82f6" />
              <StatPill icon={Zap} label="Triggers" value={String(stats.triggerCount)} color="#f59e0b" />
              <StatPill icon={Link} label="Connectors" value={String(stats.connectorCount)} color="#10b981" />
              {stats.lastRun && (
                <div className="col-span-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary/30 border border-primary/8">
                  <Clock className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[11px] text-muted-foreground/70">Last run</span>
                  <span className="text-[11px] text-foreground/80 font-medium ml-auto">{formatRelativeTime(stats.lastRun)}</span>
                </div>
              )}
            </div>
          )}

          {/* Role Selector */}
          <div>
            <label className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-2 block">
              Role
            </label>
            <div className="space-y-1.5">
              {TEAM_ROLES.map((role) => (
                <button
                  key={role.value}
                  onClick={() => onRoleChange(member.id, role.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    member.role === role.value
                      ? 'bg-indigo-500/10 border-indigo-500/25'
                      : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                  }`}
                >
                  <div className={`text-sm font-medium ${member.role === role.value ? 'text-indigo-300' : 'text-foreground/90'}`}>
                    {role.label}
                  </div>
                  <div className="text-sm text-muted-foreground/80 mt-0.5">{role.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-primary/10">
          <AnimatePresence mode="wait">
            {confirmRemove ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2 text-sm text-amber-400/70">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Remove "{personaName}" from team?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onRemove(member.id);
                      onClose();
                    }}
                    className="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-secondary/50 text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/70 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="remove"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                onClick={() => setConfirmRemove(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15 text-sm font-medium transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove from Team
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Compact stat pill for the stats grid */
function StatPill({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary/30 border border-primary/8">
      <Icon className="w-3 h-3 shrink-0" style={{ color: color + 'aa' }} />
      <span className="text-[11px] text-muted-foreground/70 truncate">{label}</span>
      <span className="text-[11px] text-foreground/80 font-semibold ml-auto">{value}</span>
    </div>
  );
}
