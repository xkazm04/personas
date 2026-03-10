import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { motion } from 'framer-motion';

interface RunnerEmptyStateProps {
  persona: {
    name: string;
    icon?: string | null;
    color?: string | null;
  };
}

export function RunnerEmptyState({ persona }: RunnerEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-16 gap-4"
      data-testid="runner-empty-state"
    >
      {persona.icon ? (
        sanitizeIconUrl(persona.icon) ? (
          <img src={sanitizeIconUrl(persona.icon)!} alt="" className="w-12 h-12 rounded-xl opacity-60" referrerPolicy="no-referrer" crossOrigin="anonymous" />
        ) : isIconUrl(persona.icon) ? null : (
          <span className="text-4xl leading-none opacity-60">{persona.icon}</span>
        )
      ) : (
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold opacity-50"
          style={{
            backgroundColor: `${persona.color || '#6B7280'}20`,
            border: `1px solid ${persona.color || '#6B7280'}40`,
            color: persona.color || '#6B7280',
          }}
        >
          {persona.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-foreground/70">{persona.name}</p>
        <p className="text-sm text-zinc-500">
          Ready to execute &mdash; click Run or press{' '}
          <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 text-sm font-mono">
            Enter
          </kbd>
        </p>
      </div>
    </motion.div>
  );
}
