import { useMemo } from 'react';
import { Mail, Database, MessageSquare, BookOpen, Globe, Github, Cloud } from 'lucide-react';
import { getStatusEntry, formatDuration, formatRelativeTime, badgeClass } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';

/** Shared grid template — used by both ExecutionTable header and rows */
export const EXECUTION_GRID_COLS = 'minmax(140px,2fr) 100px minmax(100px,1.2fr) 90px 120px 100px';

// Connector icon map — maps service_type/name to icon + color
const CONNECTOR_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  gmail:              { icon: Mail,          color: '#ea4335', label: 'Gmail' },
  google:             { icon: Mail,          color: '#ea4335', label: 'Gmail' },
  notion:             { icon: BookOpen,      color: '#000000', label: 'Notion' },
  personas_database:  { icon: Database,      color: '#6366f1', label: 'Database' },
  database:           { icon: Database,      color: '#6366f1', label: 'Database' },
  personas_messages:  { icon: MessageSquare, color: '#10b981', label: 'Messages' },
  personas_vector_db: { icon: Database,      color: '#8b5cf6', label: 'Vector DB' },
  github:             { icon: Github,        color: '#f0f6fc', label: 'GitHub' },
  slack:              { icon: MessageSquare, color: '#e01e5a', label: 'Slack' },
  web_search:         { icon: Globe,         color: '#3b82f6', label: 'Web' },
  cloud:              { icon: Cloud,         color: '#06b6d4', label: 'Cloud' },
};

function extractConnectors(persona: Persona | undefined): string[] {
  if (!persona?.last_design_result) return [];
  try {
    const dr = JSON.parse(persona.last_design_result);
    const connectors = dr.suggested_connectors;
    if (Array.isArray(connectors)) {
      return connectors
        .map((c: { name?: string; service_type?: string }) => c.service_type || c.name || '')
        .filter(Boolean);
    }
  } catch { /* ignore */ }
  return [];
}

interface ExecutionVirtualRowProps {
  exec: GlobalExecution;
  index: number;
  start: number;
  size: number;
  onSelect: (exec: GlobalExecution) => void;
  personas?: Persona[];
}

export function ExecutionVirtualRow({ exec, index, start, size, onSelect, personas }: ExecutionVirtualRowProps) {
  const status = getStatusEntry(exec.status);
  const hoverAccent =
    exec.status === 'running' || exec.status === 'pending'
      ? 'hover:border-l-blue-400'
      : exec.status === 'completed'
        ? 'hover:border-l-emerald-400'
        : exec.status === 'failed'
          ? 'hover:border-l-red-400'
          : 'hover:border-l-amber-400';

  const connectors = useMemo(() => {
    const p = personas?.find((p) => p.id === exec.persona_id);
    return extractConnectors(p);
  }, [personas, exec.persona_id]);

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect(exec)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(exec);
        }
      }}
      style={{
        position: 'absolute',
        top: 0,
        transform: `translateY(${start}px)`,
        width: '100%',
        height: `${size}px`,
        gridTemplateColumns: EXECUTION_GRID_COLS,
      }}
      className={`grid items-center cursor-pointer transition-colors border-b border-primary/[0.06] border-l-2 border-l-transparent hover:bg-white/[0.05] ${hoverAccent} ${index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
    >
      {/* Persona */}
      <div className="flex items-center gap-2 px-4 min-w-0">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
          style={{ backgroundColor: (exec.persona_color || '#6366f1') + '15' }}
        >
          {exec.persona_icon || '?'}
        </div>
        <span className="text-sm font-medium text-foreground/80 truncate">
          {exec.persona_name || 'Unknown'}
        </span>
      </div>

      {/* Connectors */}
      <div className="flex items-center gap-1 px-4 min-w-0">
        {connectors.length > 0 ? (
          connectors.slice(0, 4).map((c) => {
            const info = CONNECTOR_ICONS[c] || CONNECTOR_ICONS[c.split('_')[0] || ''];
            if (!info) return null;
            const Icon = info.icon;
            return (
              <div
                key={c}
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: info.color + '18' }}
                title={info.label}
              >
                <Icon className="w-3 h-3" style={{ color: info.color }} />
              </div>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Status */}
      <div className="px-4 min-w-0">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-sm font-medium ${badgeClass(status)}`}>
          {status.pulse && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
          )}
          {status.label}
        </span>
      </div>

      {/* Duration */}
      <div className="px-4 text-right">
        <span className="text-sm text-muted-foreground/90 font-mono">
          {formatDuration(exec.duration_ms)}
        </span>
      </div>

      {/* Started */}
      <div className="px-4 text-right">
        <span className="text-sm text-muted-foreground/80">
          {formatRelativeTime(exec.started_at || exec.created_at)}
        </span>
      </div>

      {/* ID */}
      <div className="px-4 min-w-0">
        <span className="text-sm text-muted-foreground/60 font-mono truncate block">
          {exec.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
