import { FlaskConical } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/80">
      <FlaskConical className="w-12 h-12 opacity-30" />
      <p className="text-sm font-medium">No generated templates yet</p>
      <p className="text-sm text-muted-foreground/80 text-center max-w-xs">
        Use the <span className="text-cyan-300">Synthesize Team</span> button in the header or the Claude Code skill to generate templates.
      </p>
    </div>
  );
}
