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
  sm: { container: 'w-7 h-7', img: 'w-4 h-4', text: 'text-xs' },
  md: { container: 'w-9 h-9', img: 'w-5 h-5', text: 'text-base' },
  lg: { container: 'w-10 h-10', img: 'w-5 h-5', text: 'text-base' },
};

export function PersonaAvatar({ icon, color, size = 'md' }: PersonaAvatarProps) {
  const c = color || '#6366f1';
  const isUrl = typeof icon === 'string' && icon.startsWith('http');
  const s = sizeClasses[size];

  return (
    <div
      className={`${s.container} rounded-lg flex items-center justify-center border shrink-0`}
      style={{
        backgroundColor: c + '15',
        borderColor: c + '30',
      }}
    >
      {isUrl ? (
        <img src={icon!} alt="" className={`${s.img} rounded object-cover`} />
      ) : (
        <span className={s.text}>{icon || '\u{1F916}'}</span>
      )}
    </div>
  );
}
