import { useCallback } from 'react';
import { FolderKanban, X, Eye } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { killSession, removeSession } from '@/api/fleet/fleet';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { FleetStatusBadge } from './FleetStatusBadge';

function relativeTime(ms: bigint): string {
  const now = Date.now();
  const diff = now - Number(ms);
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function FleetSessionCard({ session }: { session: FleetSession }) {
  const isActive = useSystemStore((s) => s.fleetActiveSessionId === session.id);
  const setActive = useSystemStore((s) => s.fleetSetActiveSession);
  const removeLocal = useSystemStore((s) => s.fleetRemoveSessionLocal);

  const handleOpen = useCallback(() => {
    setActive(session.id);
  }, [session.id, setActive]);

  const handleClose = useCallback(async () => {
    try {
      if (session.state === 'exited') {
        await removeSession(session.id);
        removeLocal(session.id);
      } else {
        await killSession(session.id);
      }
    } catch (e) {
      toastCatch('FleetSessionCard:close', 'Failed to close session')(e);
    }
  }, [session.id, session.state, removeLocal]);

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={`w-full text-left border rounded-modal px-3 py-2.5 transition-colors ${
        isActive
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-primary/10 hover:border-primary/20 bg-secondary/20 hover:bg-secondary/30'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <FleetStatusBadge state={session.state} reason={session.stateReason} />
        {isActive && (
          <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400">
            <Eye className="w-2.5 h-2.5" />
            viewing
          </span>
        )}
        <span className="ml-auto text-[10px] text-foreground/50">{relativeTime(session.lastActivityMs)}</span>
      </div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <FolderKanban className="w-3 h-3 text-foreground/50 flex-shrink-0" />
        <span className="typo-caption font-medium truncate">{session.projectLabel}</span>
      </div>
      <p className="text-[10px] font-mono text-foreground/50 truncate" title={session.cwd}>
        {session.cwd}
      </p>
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-primary/5">
        {session.claudeSessionId && (
          <span className="text-[9px] font-mono text-foreground/40 truncate">
            cc:{session.claudeSessionId.slice(0, 8)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          title={session.state === 'exited' ? 'Remove from list' : 'Close session'}
          className="ml-auto"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </button>
  );
}
