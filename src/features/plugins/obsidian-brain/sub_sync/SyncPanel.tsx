import { useState, useEffect, useCallback } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { ArrowUpFromLine, ArrowDownToLine, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw, GitMerge } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
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
  type ObsidianConflictResolution,
} from '@/api/obsidianBrain';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import SyncResultCard, { type SyncResultSummary } from './SyncResultCard';

export default function SyncPanel() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const activeVaultPath = useSystemStore((s) => s.obsidianVaultPath);
  const activeVaultName = useSystemStore((s) => s.obsidianVaultName);
  const setSyncRunning = useSystemStore((s) => s.setObsidianSyncRunning);
  const setLastSyncAt = useSystemStore((s) => s.setObsidianLastSyncAt);
  const setPendingConflicts = useSystemStore((s) => s.setObsidianPendingConflicts);

  const personas = useAgentStore((s) => s.personas);

  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  // Most recent result per direction, newest first. Persisted in state (not
  // just a toast) so the user can review what changed at their own pace.
  const [syncResults, setSyncResults] = useState<SyncResultSummary[]>([]);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const recordResult = useCallback((summary: SyncResultSummary) => {
    setSyncResults((prev) => [summary, ...prev.filter((r) => r.direction !== summary.direction)]);
  }, []);

  useEffect(() => {
    if (connected) {
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    }
  }, [connected, activeVaultPath]);

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

  const deselectAll = useCallback(() => {
    setSelectedPersonaIds(new Set());
  }, []);

  const pushSync = useCallback(async () => {
    setPushing(true);
    setSyncRunning(true);
    try {
      // Always send the explicit selection. Per @/api/obsidianBrain contract,
      // `undefined` means "sync ALL personas" — sending it here when the user
      // could have actively deselected everything would silently overwrite
      // their vault. The API short-circuits an empty array to a no-op result.
      const ids = [...selectedPersonaIds];
      const result = await obsidianBrainPushSync(ids);
      recordResult({
        direction: 'push',
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        at: new Date().toISOString(),
      });
      setLastSyncAt(new Date().toISOString());
      addToast(`Push: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`, result.errors.length > 0 ? 'error' : 'success');
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    } catch (e) {
      addToast(`Push failed: ${e}`, 'error');
    } finally {
      setPushing(false);
      setSyncRunning(false);
    }
  }, [selectedPersonaIds, addToast, recordResult, setSyncRunning, setLastSyncAt]);

  const pullSync = useCallback(async () => {
    setPulling(true);
    setSyncRunning(true);
    try {
      const result = await obsidianBrainPullSync();
      setConflicts(result.conflicts);
      setPendingConflicts(result.conflicts.length);
      recordResult({
        direction: 'pull',
        created: result.created,
        updated: result.updated,
        conflicts: result.conflicts.length,
        converged: result.converged ?? 0,
        errors: result.errors,
        at: new Date().toISOString(),
      });
      setLastSyncAt(new Date().toISOString());
      addToast(`Pull: ${result.created} created, ${result.updated} updated${result.conflicts.length > 0 ? `, ${result.conflicts.length} conflicts` : ''}`, result.conflicts.length > 0 ? 'error' : 'success');
      // Lucky-convergence audit trail: both sides edited but ended up
      // identical. Distinct from a no-op so the user sees the avoided
      // conflict instead of nothing.
      if (result.converged && result.converged > 0) {
        const noun = result.converged === 1 ? 'entry' : 'entries';
        addToast(
          `Both sides edited ${result.converged} ${noun} and ended up identical — keeping shared version`,
          'success',
        );
      }
      obsidianBrainGetSyncLog(50).then(setSyncLog).catch(() => {});
    } catch (e) {
      addToast(`Pull failed: ${e}`, 'error');
    } finally {
      setPulling(false);
      setSyncRunning(false);
    }
  }, [addToast, recordResult, setSyncRunning, setLastSyncAt, setPendingConflicts]);

  const resolveConflict = useCallback(async (conflict: SyncConflict, resolution: ObsidianConflictResolution) => {
    try {
      await obsidianBrainResolveConflict(conflict, resolution);
      setConflicts((prev) => {
        const next = prev.filter((c) => c.id !== conflict.id);
        setPendingConflicts(next.length);
        return next;
      });
      addToast(`Conflict resolved (${resolution})`, 'success');
    } catch (e) {
      addToast(`Resolution failed: ${e}`, 'error');
    }
  }, [addToast, setPendingConflicts]);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title={t.plugins.obsidian_brain.no_vault_connected}
          subtitle={t.plugins.obsidian_brain.no_vault_hint}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
        />
      </div>
    );
  }

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      {/* Active Vault */}
      {activeVaultName && (
        <div className="flex items-center gap-2 px-1">
          <span className="typo-caption text-foreground">{t.plugins.obsidian_brain.active_vault_label}</span>
          <span className="typo-caption text-violet-300">{activeVaultName}</span>
        </div>
      )}

      {/* Sync Actions */}
      <SectionCard title={t.plugins.obsidian_brain.sync_actions}>
        <div className="space-y-4">
          <div className="flex gap-3">
            <button
              onClick={pushSync}
              disabled={pushing || pulling || selectedPersonaIds.size === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
            >
              {pushing ? <LoadingSpinner size="sm" /> : <ArrowUpFromLine className="w-4 h-4" />}
              {pushing
                ? t.plugins.obsidian_brain.pushing
                : `${t.plugins.obsidian_brain.push_to_vault} (${selectedPersonaIds.size})`}
            </button>
            <button
              onClick={pullSync}
              disabled={pushing || pulling}
              className="flex items-center gap-2 px-5 py-2.5 rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 focus-ring"
            >
              {pulling ? <LoadingSpinner size="sm" /> : <ArrowDownToLine className="w-4 h-4" />}
              {pulling ? t.plugins.obsidian_brain.pulling : t.plugins.obsidian_brain.pull_from_vault}
            </button>
          </div>

          {/* Persona Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="typo-label text-foreground/90">{t.plugins.obsidian_brain.select_personas_push}</p>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="typo-caption text-violet-400/60 hover:text-violet-400 transition-colors focus-ring rounded px-1.5 py-0.5">
                  {t.plugins.obsidian_brain.select_all}
                </button>
                <button
                  onClick={deselectAll}
                  disabled={selectedPersonaIds.size === 0}
                  className="typo-caption text-foreground hover:text-foreground transition-colors focus-ring rounded px-1.5 py-0.5 disabled:opacity-40"
                >
                  {t.plugins.obsidian_brain.deselect_all}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePersona(p.id)}
                  className={`px-3 py-1.5 rounded-card typo-caption transition-colors border focus-ring ${
                    selectedPersonaIds.has(p.id)
                      ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                      : 'bg-secondary/20 text-foreground border-primary/10 hover:border-primary/20'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {personas.length === 0 && (
                <p className="typo-caption text-foreground">{t.plugins.obsidian_brain.no_personas_found}</p>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Sync Result Summaries — persistent, reviewable, direction-distinct */}
      {syncResults.length > 0 && (
        <div className="space-y-2">
          {syncResults.map((r) => (
            <SyncResultCard key={r.direction} summary={r} />
          ))}
        </div>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <SectionCard collapsible title={`Conflicts (${conflicts.length})`} status="warning" storageKey="obsidian-sync-conflicts">
          <div className="space-y-3">
            {conflicts.map((c) => (
              <div key={c.id} className="px-4 py-3 rounded-modal bg-amber-500/5 border border-amber-500/20 space-y-3">
                <div>
                  <p className="typo-heading typo-card-label">{c.entityType}: {c.entityId.slice(0, 8)}...</p>
                  <p className="typo-caption text-foreground">{c.filePath}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="typo-caption text-blue-400/70">{t.plugins.obsidian_brain.app_version}</p>
                    <pre className="typo-caption text-foreground bg-secondary/30 rounded-card p-2.5 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                      {c.appContent.slice(0, 500)}{c.appContent.length > 500 ? '...' : ''}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p className="typo-caption text-violet-400/70">{t.plugins.obsidian_brain.vault_version}</p>
                    <pre className="typo-caption text-foreground bg-secondary/30 rounded-card p-2.5 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                      {c.vaultContent.slice(0, 500)}{c.vaultContent.length > 500 ? '...' : ''}
                    </pre>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => resolveConflict(c, 'use_app')} className="px-3 py-1.5 rounded-card typo-caption bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors focus-ring">
                    {t.plugins.obsidian_brain.keep_app}
                  </button>
                  <button onClick={() => resolveConflict(c, 'use_vault')} className="px-3 py-1.5 rounded-card typo-caption bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors focus-ring">
                    {t.plugins.obsidian_brain.keep_vault}
                  </button>
                  <button onClick={() => resolveConflict(c, 'skip')} className="px-3 py-1.5 rounded-card typo-caption bg-secondary/30 text-foreground border border-primary/10 hover:bg-secondary/50 transition-colors focus-ring">
                    {t.plugins.obsidian_brain.skip}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Sync Log */}
      <SectionCard collapsible title={t.plugins.obsidian_brain.sync_log} storageKey="obsidian-sync-log" defaultCollapsed={syncLog.length === 0}>
        {syncLog.length === 0 ? (
          <p className="typo-body text-foreground py-4">{t.plugins.obsidian_brain.no_sync_activity}</p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {syncLog.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/10 hover:bg-secondary/20 transition-colors">
                {entry.action === 'created' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                {entry.action === 'updated' && <RefreshCw className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                {entry.action === 'conflict' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                {entry.action === 'converged' && <GitMerge className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
                {entry.action === 'skipped' && <XCircle className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
                {!['created', 'updated', 'conflict', 'converged', 'skipped'].includes(entry.action) && <Clock className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="typo-caption text-foreground">
                    {entry.syncType} {entry.entityType}
                  </span>
                  {entry.details && (
                    <span className="typo-caption text-foreground ml-2">{entry.details}</span>
                  )}
                </div>
                <span className="typo-caption text-foreground flex-shrink-0 tabular-nums">
                  {<AbsoluteTime timestamp={entry.createdAt} variant="time" />}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      </div>

      <SavedConfigsSidebar
        emptyHint={t.plugins.obsidian_brain.saved_vaults_empty_hint_other}
      />
    </div>
  );
}
