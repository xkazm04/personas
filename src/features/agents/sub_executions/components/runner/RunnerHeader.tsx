import { useAgentStore } from "@/stores/agentStore";
import { Pin, PinOff } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getStatusEntry } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

export function MiniPlayerPinButton() {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const pinned = useAgentStore((s) => s.miniPlayerPinned);
  const pin = useAgentStore((s) => s.pinMiniPlayer);
  const unpin = useAgentStore((s) => s.unpinMiniPlayer);

  return (
    <Tooltip content={pinned ? e.unpin_mini_player : e.pin_to_mini_player}>
      <Button
        variant="ghost"
        size="sm"
        pressed={pinned}
        onClick={pinned ? unpin : pin}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        <span className="typo-body">{pinned ? e.pinned : e.pin}</span>
      </Button>
    </Tooltip>
  );
}

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const entry = getStatusEntry(status);
  return <entry.icon className={`${entry.text} ${className ?? ''}`} />;
}
