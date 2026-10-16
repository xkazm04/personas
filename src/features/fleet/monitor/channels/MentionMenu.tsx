import { Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Keycap } from '@/features/decision-center/deck/parts';

/** The @-mention list above the composer: the first row takes Tab. */
export function MentionMenu({ candidates, onPick }: {
  candidates: Array<{ personaId: string; name: string }>;
  onPick: (name: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="absolute bottom-full left-3 z-20 mb-1 min-w-[200px] rounded-card border border-border bg-background p-1 shadow-elevation-3">
      {candidates.map((m, i) => (
        <Button
          key={m.personaId}
          variant="ghost"
          size="xs"
          block
          onMouseDown={(e) => { e.preventDefault(); onPick(m.name); }}
          className={`justify-start! ${i === 0 ? 'bg-primary/10' : ''} [&>span:last-child]:flex [&>span:last-child]:w-full [&>span:last-child]:items-center [&>span:last-child]:gap-2`}
          icon={m.personaId === 'athena' ? <Sparkles className="h-3 w-3 text-role-agent" aria-hidden /> : undefined}
        >
          <span className="min-w-0 flex-1 truncate text-left typo-body text-foreground">{m.name.replace(/^T:\s*/, '')}</span>
          {i === 0 && <Keycap>Tab</Keycap>}
        </Button>
      ))}
    </div>
  );
}
