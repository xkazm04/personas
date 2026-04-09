import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ArrowUpFromLine, ArrowDownToLine, Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import {
  obsidianBrainPushSync,
  obsidianBrainPullSync,
  obsidianBrainGetSyncLog,
  obsidianBrainResolveConflict,
  type SyncLogEntry,
  type SyncConflict,
  type PushSyncResult,
} from '@/api/obsidianBrain';

export default function SyncPanel() {
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const setSyncRunning = useSystemStore((s) => s.setObsidianSyncRunning);
  const setLastSyncAt = useSystemStore((s) => s.setObsidianLastSyncAt);
  const setPendingConflicts = useSystemStore((s) => s.setObsidianPendingConflicts);

  const personas = useAgentStore((s) => s.personas);

  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushResult, setPushResult] = useState<PushSyncResult | null>(null);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  useEffect(() => {
    if (connected) {
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    }
  }, [connected]);

  const togglePersona = useCallback((id: string) => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPersonaIds(new Set(personas.map((p) => p.id)));
  }, [personas]);

  const pushSync = useCallback(async () => {
    setPushing(true);
    setSyncRunning(true);
    try {
      const ids = selectedPersonaIds.size > 0 ? [...selectedPersonaIds] : undefined;
      const result = await obsidianBrainPushSync(ids);
      setPushResult(result);
      setLastSyncAt(new Date().toISOString());
      addToast(`Push: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`, result.errors.length > 0 ? 'error' : 'success');
      // Refresh log
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    } catch (e) {
      addToast(`Push failed: ${e}`, 'error');
    } finally {
      setPushing(false);
      setSyncRunning(false);
    }
  }, [selectedPersonaIds, addToast, setSyncRunning, setLastSyncAt]);

  const pullSync = useCallback(async () => {
    setPulling(true);
    setSyncRunning(true);
    try {
      const result = await obsidianBrainPullSync();
      setConflicts(result.conflicts);
      setPendingConflicts(result.conflicts.length);
      setLastSyncAt(new Date().toISOString());
      addToast(`Pull: ${result.created} created, ${result.updated} updated${result.conflicts.length > 0 ? `, ${result.conflicts.length} conflicts` : ''}`, result.conflicts.length > 0 ? 'error' : 'success');
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    } catch (e) {
      addToast(`Pull failed: ${e}`, 'error');
    } finally {
      setPulling(false);
      setSyncRunning(false);
    }
  }, [addToast, setSyncRunning, setLastSyncAt, setPendingConflicts]);

  const resolveConflict = useCallback(async (conflict: SyncConflict, resolution: string) => {
    try {
      await obsidianBrainResolveConflict(conflict, resolution);
      setConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
      setPendingConflicts(Math.max(0, conflicts.length - 1));
      addToast(`Conflict resolved (${resolution})`, 'success');
    } catch (e) {
      addToast(`Resolution failed: ${e}`, 'error');
    }
  }, [conflicts.length, addToast, setPendingConflicts]);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400/50 mx-auto" />
          <p className="typo-heading text-foreground/70">No Vault Connected</p>
          <p className="typo-body text-muted-foreground/50">Set up an Obsidian vault in the Setup tab first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-4">
      {/* Sync Actions */}
      <section className="space-y-3">
        <h2 className="typo-heading text-foreground/90">Sync Actions</h2>
        <div className="flex gap-3">
          <button
            onClick={pushSync}
            disabled={pushing || pulling}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40"
          >
            <ArrowUpFromLine className={`w-4 h-4 ${pushing ? 'animate-bounce' : ''}`} />
            {pushing ? 'Pushing...' : 'Push to Vault'}
          </button>
          <button
            onClick={pullSync}
            disabled={pushing || pulling}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            <ArrowDownToLine className={`w-4 h-4 ${pulling ? 'animate-bounce' : ''}`} />
            {pulling ? 'Pulling...' : 'Pull from Vault'}
          </button>
        </div>
      </section>

      {/* Persona Selection */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="typo-caption text-muted-foreground/60">Select personas to push</h3>
          <button onClick={selectAll} className="typo-caption text-violet-400/60 hover:text-violet-400">
            Select all
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => togglePersona(p.id)}
              className={`px-3 py-1.5 rounded-lg typo-caption transition-colors border ${
                selectedPersonaIds.has(p.id)
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                  : 'bg-secondary/20 text-muted-foreground/50 border-primary/10 hover:border-primary/20'
              }`}
            >
              {p.name}
            </button>
          ))}
          {personas.length === 0 && (
            <p className="typo-caption text-muted-foreground/40">No personas found</p>
          )}
        </div>
      </section>

      {/* Last Sync Result */}
      {pushResult && (
        <div className="px-4 py-3 rounded-lg bg-secondary/20 border border-primary/10 space-y-1">
          <p className="typo-caption text-muted-foreground/60">Last Push Result</p>
          <div className="flex gap-4 typo-body">
            <span className="text-emerald-400">{pushResult.created} created</span>
            <span className="text-blue-400">{pushResult.updated} updated</span>
            <span className="text-muted-foreground/40">{pushResult.skipped} skipped</span>
            {pushResult.errors.length > 0 && (
              <span className="text-red-400">{pushResult.errors.length} errors</span>
            )}
          </div>
        </div>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <section className="space-y-3">
          <h2 className="typo-heading text-amber-400">Conflicts ({conflicts.length})</h2>
          {conflicts.map((c) => (
            <div key={c.id} className="px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-3">
              <div>
                <p className="typo-heading text-foreground/80">{c.entityType}: {c.entityId.slice(0, 8)}...</p>
                <p className="typo-caption text-muted-foreground/50">{c.filePath}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="typo-caption text-blue-400/70">App Version</p>
                  <pre className="text-[11px] text-foreground/50 bg-secondary/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {c.appContent.slice(0, 500)}{c.appContent.length > 500 ? '...' : ''}
                  </pre>
                </div>
                <div className="space-y-1">
                  <p className="typo-caption text-violet-400/70">Vault Version</p>
                  <pre className="text-[11px] text-foreground/50 bg-secondary/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {c.vaultContent.slice(0, 500)}{c.vaultContent.length > 500 ? '...' : ''}
                  </pre>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => resolveConflict(c, 'use_app')} className="px-3 py-1.5 rounded-lg typo-caption bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20">
                  Keep App
                </button>
                <button onClick={() => resolveConflict(c, 'use_vault')} className="px-3 py-1.5 rounded-lg typo-caption bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20">
                  Keep Vault
                </button>
                <button onClick={() => resolveConflict(c, 'skip')} className="px-3 py-1.5 rounded-lg typo-caption bg-secondary/30 text-muted-foreground/50 border border-primary/10 hover:bg-secondary/50">
                  Skip
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Sync Log */}
      <section className="space-y-2">
        <h2 className="typo-heading text-foreground/90">Sync Log</h2>
        {syncLog.length === 0 ? (
          <p className="typo-body text-muted-foreground/40 py-4">No sync activity yet. Push or pull to start.</p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {syncLog.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/10 hover:bg-secondary/20">
                {entry.action === 'created' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                {entry.action === 'updated' && <RefreshCw className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                {entry.action === 'conflict' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                {entry.action === 'skipped' && <XCircle className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />}
                {!['created', 'updated', 'conflict', 'skipped'].includes(entry.action) && <Clock className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="typo-caption text-foreground/60">
                    {entry.syncType} {entry.entityType}
                  </span>
                  {entry.details && (
                    <span className="typo-caption text-muted-foreground/40 ml-2">{entry.details}</span>
                  )}
                </div>
                <span className="typo-caption text-muted-foreground/30 flex-shrink-0">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
