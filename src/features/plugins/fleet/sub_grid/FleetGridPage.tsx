import { useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Play, X, FolderInput } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { spawnSession, killSession } from '@/api/fleet/fleet';
import { FleetTerminalPane } from '../FleetTerminalPane';

/**
 * Phase 3 test-bed: one cwd input + one spawn button → one xterm pane.
 *
 * Phase 7 replaces this with the proper project-grouped grid; for now we
 * just need a way to prove the PTY spine works end-to-end.
 */
export default function FleetGridPage() {
  const [cwd, setCwd] = useState<string>('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const handleSpawn = useCallback(async () => {
    if (!cwd.trim() || spawning) return;
    setSpawning(true);
    try {
      const id = await spawnSession(cwd.trim());
      setActiveSessionId(id);
    } catch (e) {
      toastCatch('FleetGridPage:spawn', 'Failed to spawn Claude Code session')(e);
    } finally {
      setSpawning(false);
    }
  }, [cwd, spawning]);

  const handleKill = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await killSession(activeSessionId);
    } catch (e) {
      toastCatch('FleetGridPage:kill', 'Failed to close session')(e);
    } finally {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Sessions"
        subtitle="Phase 3 test-bed: spawn one Claude Code session and interact with it via xterm.js"
      />
      <ContentBody>
        <ActionRow>
          <div className="flex-1 flex items-center gap-2">
            <FolderInput className="w-4 h-4 text-foreground/50 flex-shrink-0" />
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="C:\path\to\project"
              disabled={!!activeSessionId || spawning}
              className="flex-1 px-3 py-1.5 typo-caption font-mono bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30 disabled:opacity-50"
            />
          </div>
          {activeSessionId ? (
            <Button
              variant="danger"
              size="sm"
              icon={<X className="w-3.5 h-3.5" />}
              onClick={handleKill}
            >
              Close session
            </Button>
          ) : (
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              disabled={!cwd.trim() || spawning}
              onClick={handleSpawn}
            >
              {spawning ? 'Spawning…' : 'Spawn `claude`'}
            </Button>
          )}
        </ActionRow>

        {activeSessionId ? (
          <div className="mt-3 border border-primary/10 rounded-modal overflow-hidden h-[calc(100vh-280px)] min-h-[400px]">
            <FleetTerminalPane sessionId={activeSessionId} />
          </div>
        ) : (
          <div className="mt-3 text-center py-20 border border-dashed border-primary/10 rounded-modal">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <TerminalIcon className="w-7 h-7 text-amber-400/50" />
            </div>
            <p className="text-md text-foreground/80 mb-1">No active session</p>
            <p className="text-md text-foreground/50">
              Enter a project directory above and click Spawn to launch <code className="px-1 py-0.5 rounded bg-primary/10">claude</code> inside a Fleet-owned PTY.
            </p>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
