import { useState, useEffect, useMemo } from 'react';
import { X, Trash2, AlertTriangle, Wrench, Zap, Link, Clock, ExternalLink, Cpu } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { TEAM_ROLES, PersonaAvatar } from '@/features/pipeline/sub_canvas';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { extractConnectorNames } from '@/lib/personas/utils';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { AgentIR } from '@/lib/types/designTypes';
import { useTranslation } from '@/i18n/useTranslation';

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
    const dr = JSON.parse(designResult) as AgentIR;
    return dr.suggested_tools?.length ?? 0;
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return 0;
  }
}

export default function TeamConfigPanel({ member, onClose, onRoleChange, onRemove }: TeamConfigPanelProps) {
  const { t, tx } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const personas = useAgentStore((s) => s.personas);
  const personaTriggerCounts = useAgentStore((s) => s.personaTriggerCounts);
  const personaLastRun = useAgentStore((s) => s.personaLastRun);
  const personaHealthMap = useAgentStore((s) => s.personaHealthMap);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  // Look up the full persona record for stats
  const persona = useMemo(
    () => (member?.persona_id ? personas.find((p) => p.id === member.persona_id) : undefined),
    [member?.persona_id, personas],
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

  if (!member) return null;

  const personaName = member.persona_name || member.name || 'Agent';
  const personaIcon = member.persona_icon || member.icon || '';
  const personaColor = member.persona_color || member.color || '#6366f1';

  const handleViewPersona = () => {
    if (!member.persona_id) return;
    selectPersona(member.persona_id);
    setSidebarSection('personas');
    onClose();
  };

  return (
    <div
        className="animate-fade-slide-in absolute top-0 right-0 bottom-0 w-72 bg-background/95 backdrop-blur-md border-l border-primary/15 z-20 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <span className="typo-code font-mono text-foreground uppercase tracking-wider">{t.pipeline.configure}</span>
          <button
            onClick={onClose}
            className="p-1 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground/95 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Persona Info */}
          <div className="flex items-center gap-3 p-3 rounded-modal bg-secondary/40 border border-primary/10">
            <PersonaAvatar icon={personaIcon} color={personaColor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="typo-heading font-semibold text-foreground/90 truncate">{personaName}</div>
              <div className="typo-code text-foreground font-mono truncate">{member.id?.slice(0, 8)}...</div>
            </div>
            {member.persona_id && (
              <button
                onClick={handleViewPersona}
                title={t.pipeline.view_persona}
                className="p-1.5 rounded-card hover:bg-secondary/70 text-foreground hover:text-foreground/80 transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Persona Stats */}
          {stats && (
            <div className="grid grid-cols-2 gap-1.5">
              <StatPill icon={Cpu} label={t.pipeline.model_label} value={stats.model} color={personaColor} />
              <StatPill icon={Wrench} label={t.pipeline.tools_label} value={String(stats.toolCount)} color="#3b82f6" />
              <StatPill icon={Zap} label={t.pipeline.triggers_label} value={String(stats.triggerCount)} color="#f59e0b" />
              <StatPill icon={Link} label={t.pipeline.connectors_label} value={String(stats.connectorCount)} color="#10b981" />
              {stats.lastRun && (
                <div className="col-span-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal bg-secondary/30 border border-primary/8">
                  <Clock className="w-3 h-3 text-foreground shrink-0" />
                  <span className="typo-body text-foreground">{t.pipeline.last_run}</span>
                  <span className="typo-body text-foreground font-medium ml-auto">{formatRelativeTime(stats.lastRun)}</span>
                </div>
              )}
            </div>
          )}

          {/* Role Selector */}
          <div>
            <label className="typo-code font-mono text-foreground uppercase tracking-wider mb-2 block">
              {t.pipeline.role}
            </label>
            <div className="space-y-1.5">
              {TEAM_ROLES.map((role) => (
                <button
                  key={role.value}
                  onClick={() => onRoleChange(member.id, role.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-modal border transition-all ${
                    member.role === role.value
                      ? 'bg-indigo-500/10 border-indigo-500/25'
                      : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                  }`}
                >
                  <div className={`typo-body font-medium ${member.role === role.value ? 'text-indigo-300' : 'text-foreground/90'}`}>
                    {role.label}
                  </div>
                  <div className="typo-body text-foreground mt-0.5">{role.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-primary/10">
          {confirmRemove ? (
              <div
                key="confirm"
                className="animate-fade-slide-in space-y-2"
              >
                <div className="flex items-center gap-2 typo-body text-amber-400/70">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {tx(t.pipeline.remove_confirm, { name: personaName })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onRemove(member.id);
                      onClose();
                    }}
                    className="flex-1 px-3 py-1.5 typo-body font-medium rounded-modal bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
                  >
                    {t.common.confirm}
                  </button>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 px-3 py-1.5 typo-body font-medium rounded-modal bg-secondary/50 text-foreground hover:text-foreground/95 hover:bg-secondary/70 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                key="remove"
                onClick={() => setConfirmRemove(true)}
                className="animate-fade-slide-in w-full flex items-center justify-center gap-2 px-3 py-2 rounded-modal border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15 typo-body font-medium transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t.pipeline.remove_from_team}
              </button>
            )}
        </div>
      </div>
  );
}

/** Compact stat pill for the stats grid */
function StatPill({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal bg-secondary/30 border border-primary/8">
      <Icon className="w-3 h-3 shrink-0" style={{ color: colorWithAlpha(color, 0.67) }} />
      <span className="typo-body text-foreground truncate">{label}</span>
      <span className="typo-heading text-foreground font-semibold ml-auto">{value}</span>
    </div>
  );
}
