import { sanitizeIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

export interface ConnectionTypeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  label: string;
}

export const DEFAULT_CONNECTION_STYLE: ConnectionTypeStyle = { stroke: '#3b82f6', strokeWidth: 2, label: 'Sequential' };

export const CONNECTION_TYPE_STYLES: Record<string, ConnectionTypeStyle> = {
  sequential: DEFAULT_CONNECTION_STYLE,
  conditional: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 3', label: 'Conditional' },
  parallel: { stroke: '#10b981', strokeWidth: 3, label: 'Parallel' },
  feedback: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '2 4', label: 'Feedback' },
};

export function getConnectionStyle(type: string): ConnectionTypeStyle {
  return CONNECTION_TYPE_STYLES[type] ?? DEFAULT_CONNECTION_STYLE;
}

export const TEAM_ROLES = [
  { value: 'orchestrator', label: 'Orchestrator', description: 'Coordinates other agents' },
  { value: 'worker', label: 'Worker', description: 'Executes assigned tasks' },
  { value: 'reviewer', label: 'Reviewer', description: 'Reviews outputs and provides feedback' },
  { value: 'router', label: 'Router', description: 'Routes tasks to appropriate agents' },
] as const;

export const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  orchestrator: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/25' },
  worker: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' },
  reviewer: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  router: { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/25' },
};

interface PersonaAvatarProps {
  icon?: string | null;
  color?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { container: 'w-7 h-7', img: 'w-4 h-4', text: 'typo-body' },
  md: { container: 'w-9 h-9', img: 'w-5 h-5', text: 'typo-body-lg' },
  lg: { container: 'w-10 h-10', img: 'w-5 h-5', text: 'typo-body-lg' },
};

export function PersonaAvatar({ icon, color, size = 'md' }: PersonaAvatarProps) {
  const c = color || '#6366f1';
  const safeUrl = sanitizeIconUrl(icon);
  const s = sizeClasses[size];

  return (
    <div
      className={`${s.container} rounded-card flex items-center justify-center border shrink-0`}
      style={{
        backgroundColor: colorWithAlpha(c, 0.08),
        borderColor: colorWithAlpha(c, 0.19),
      }}
    >
      {safeUrl ? (
        <img src={safeUrl} alt="" className={`${s.img} rounded object-cover`} referrerPolicy="no-referrer" crossOrigin="anonymous" />
      ) : (
        <span className={s.text}>{icon || '\u{1F916}'}</span>
      )}
    </div>
  );
}
