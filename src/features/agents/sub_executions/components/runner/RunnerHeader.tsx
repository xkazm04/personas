import { useAgentStore } from "@/stores/agentStore";
import { Pin, PinOff } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getStatusEntry } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

export function MiniPlayerPinButton() {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const pinned = useAgentStore((s) => s.miniPlayerPinned);
  const pin = useAgentStore((s) => s.pinMiniPlayer);
  const unpin = useAgentStore((s) => s.unpinMiniPlayer);

  return (
    <Tooltip content={pinned ? e.unpin_mini_player : e.pin_to_mini_player}>
      <button
        onClick={pinned ? unpin : pin}
        className={`p-1.5 rounded-card typo-body transition-colors flex items-center gap-1.5 ${
          pinned
            ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
            : 'hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/80'
        }`}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        <span className="typo-body">{pinned ? e.pinned : e.pin}</span>
      </button>
    </Tooltip>
  );
}

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const entry = getStatusEntry(status);
  return <entry.icon className={`${entry.text} ${className ?? ''}`} />;
}
