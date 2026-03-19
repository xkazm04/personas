import { useAgentStore } from "@/stores/agentStore";
import { Pin, PinOff } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function MiniPlayerPinButton() {
  const pinned = useAgentStore((s) => s.miniPlayerPinned);
  const pin = useAgentStore((s) => s.pinMiniPlayer);
  const unpin = useAgentStore((s) => s.unpinMiniPlayer);

  return (
    <Tooltip content={pinned ? 'Unpin mini-player' : 'Pin to mini-player'}>
      <button
        onClick={pinned ? unpin : pin}
        className={`p-1.5 rounded-lg typo-body transition-colors flex items-center gap-1.5 ${
          pinned
            ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
            : 'hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/80'
        }`}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        <span className="typo-body">{pinned ? 'Pinned' : 'Pin'}</span>
      </button>
    </Tooltip>
  );
}
