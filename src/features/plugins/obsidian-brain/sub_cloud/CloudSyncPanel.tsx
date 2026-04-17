import { useState, useEffect, useCallback } from 'react';
import { ArrowUpFromLine, ArrowDownToLine, HardDrive, User, AlertTriangle, CheckCircle2, LogIn, Globe } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAuthStore } from '@/stores/authStore';
import {
  obsidianDriveStatus,
  obsidianDrivePushSync,
  obsidianDrivePullSync,
  loginWithGoogleDrive,
  getGoogleDriveStatus,
  type DriveSyncResult,
} from '@/api/obsidianBrain';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export default function CloudSyncPanel() {
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const setDriveConnected = useSystemStore((s) => s.setObsidianDriveConnected);
  const setDriveEmail = useSystemStore((s) => s.setObsidianDriveEmail);
  const setDriveSyncRunning = useSystemStore((s) => s.setObsidianDriveSyncRunning);
  const setLastDriveSyncAt = useSystemStore((s) => s.setObsidianLastDriveSyncAt);
  const setDriveStorage = useSystemStore((s) => s.setObsidianDriveStorage);
  const setDriveFileCount = useSystemStore((s) => s.setObsidianDriveFileCount);

  const driveConnected = useSystemStore((s) => s.obsidianDriveConnected);
  const driveEmail = useSystemStore((s) => s.obsidianDriveEmail);
  const driveStorageUsed = useSystemStore((s) => s.obsidianDriveStorageUsed);
  const driveStorageLimit = useSystemStore((s) => s.obsidianDriveStorageLimit);
  const driveFileCount = useSystemStore((s) => s.obsidianDriveFileCount);

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const authLoading = useAuthStore((s) => s.isLoading);

  const [connecting, setConnecting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [lastResult, setLastResult] = useState<DriveSyncResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Check Drive connection on mount
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    getGoogleDriveStatus()
      .then((hasToken) => {
        if (hasToken) {
          setDriveConnected(true);
          // Fetch full status
          return obsidianDriveStatus().then((status) => {
            setDriveEmail(status.email);
            setDriveStorage(status.storageUsedBytes, status.storageLimitBytes);
            setDriveFileCount(status.manifestFileCount);
            if (status.lastSyncAt) setLastDriveSyncAt(status.lastSyncAt);
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const connectDrive = useCallback(async () => {
    setConnecting(true);
    try {
      await loginWithGoogleDrive();
      addToast('Google Drive authorization started — complete in the popup', 'success');
    } catch (e) {
      addToast(`Drive connection failed: ${e}`, 'error');
    } finally {
      setConnecting(false);
    }
  }, [addToast]);

  const pushToDrive = useCallback(async () => {
    setPushing(true);
    setDriveSyncRunning(true);
    try {
      const result = await obsidianDrivePushSync();
      setLastResult(result);
      setLastDriveSyncAt(new Date().toISOString());
      addToast(
        `Drive push: ${result.uploaded} uploaded, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
        result.errors.length > 0 ? 'error' : 'success',
      );
      // Refresh status
      obsidianDriveStatus().then((s) => {
        setDriveStorage(s.storageUsedBytes, s.storageLimitBytes);
        setDriveFileCount(s.manifestFileCount);
      }).catch(() => {});
    } catch (e) {
      addToast(`Drive push failed: ${e}`, 'error');
    } finally {
      setPushing(false);
      setDriveSyncRunning(false);
    }
  }, [addToast, setDriveSyncRunning, setLastDriveSyncAt, setDriveStorage, setDriveFileCount]);

  const pullFromDrive = useCallback(async () => {
    setPulling(true);
    setDriveSyncRunning(true);
    try {
      const result = await obsidianDrivePullSync();
      setLastResult(result);
      setLastDriveSyncAt(new Date().toISOString());
      addToast(
        `Drive pull: ${result.downloaded} downloaded, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
        result.errors.length > 0 ? 'error' : 'success',
      );
    } catch (e) {
      addToast(`Drive pull failed: ${e}`, 'error');
    } finally {
      setPulling(false);
      setDriveSyncRunning(false);
    }
  }, [addToast, setDriveSyncRunning, setLastDriveSyncAt]);

  // Not connected to local vault
  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title="No Vault Connected"
          subtitle="Set up a local Obsidian vault in the Setup tab first, then connect Google Drive for cloud backup."
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" label="Checking Drive connection..." />
      </div>
    );
  }

  // Not signed in
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 px-6">
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
          <User className="w-7 h-7 text-blue-400/80" />
        </div>
        <p className="typo-heading-lg typo-section-title mb-1.5">Sign in to enable cloud sync</p>
        <p className="typo-body text-foreground/90 max-w-md text-center mb-6">
          Sign in with your Google account to back up your vault to your own Google Drive
          (15 GB free). Files are stored under <code className="text-blue-400/80">Personas/ObsidianSync/</code>.
        </p>
        <button
          onClick={loginWithGoogle}
          disabled={authLoading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 transition-colors disabled:opacity-50 focus-ring"
        >
          {authLoading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          {authLoading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5 py-2">
      {/* Account & Connection */}
      <SectionCard title="Google Drive Connection">
        <div className="space-y-4">
          {/* User info */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/20 border border-primary/10">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-violet-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="typo-heading typo-card-label">{user.display_name || user.email}</p>
                <p className="typo-caption text-foreground">{user.email}</p>
              </div>
              {driveConnected ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 typo-caption">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Drive Connected
                </span>
              ) : (
                <button
                  onClick={connectDrive}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 transition-colors disabled:opacity-50 focus-ring"
                >
                  {connecting ? <LoadingSpinner size="sm" /> : <LogIn className="w-4 h-4" />}
                  {connecting ? 'Connecting...' : 'Connect Google Drive'}
                </button>
              )}
            </div>
          )}

          {/* Storage info */}
          {driveConnected && driveStorageUsed != null && driveStorageLimit != null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-foreground" />
                  <span className="typo-label text-foreground/90">Storage</span>
                </div>
                <span className="typo-caption text-foreground tabular-nums">
                  {formatBytes(driveStorageUsed)} / {formatBytes(driveStorageLimit)}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-400/60 transition-all duration-500"
                  style={{ width: `${Math.min(100, (driveStorageUsed / driveStorageLimit) * 100)}%` }}
                />
              </div>
              <p className="typo-caption text-foreground">
                {driveFileCount} files synced to Drive
                {driveEmail && driveEmail !== user?.email && ` · ${driveEmail}`}
              </p>
            </div>
          )}

          {!driveConnected && (
            <div className="px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/15">
              <p className="typo-body text-foreground/90">
                Connect Google Drive to back up your vault across devices. Files are stored in your own
                Google Drive under <code className="text-blue-400/80">Personas/ObsidianSync/</code>.
                Free alternative to Obsidian Sync ($4/month).
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Sync Actions */}
      {driveConnected && (
        <SectionCard title="Cloud Sync">
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                onClick={pushToDrive}
                disabled={pushing || pulling}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {pushing ? <LoadingSpinner size="sm" /> : <ArrowUpFromLine className="w-4 h-4" />}
                {pushing ? 'Pushing...' : 'Push to Drive'}
              </button>
              <button
                onClick={pullFromDrive}
                disabled={pushing || pulling}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {pulling ? <LoadingSpinner size="sm" /> : <ArrowDownToLine className="w-4 h-4" />}
                {pulling ? 'Pulling...' : 'Pull from Drive'}
              </button>
            </div>

            <p className="typo-caption text-foreground">
              Push uploads local vault changes to Google Drive. Pull downloads remote changes to your local vault.
              Only files that have changed since the last sync are transferred.
            </p>
          </div>
        </SectionCard>
      )}

      {/* Last Result */}
      {lastResult && (
        <SectionCard status={lastResult.errors.length > 0 ? 'warning' : 'success'}>
          <div className="space-y-2">
            <p className="typo-label text-foreground/90">Last Sync Result</p>
            <div className="flex gap-4 typo-body">
              {lastResult.uploaded > 0 && <span className="text-blue-400">{lastResult.uploaded} uploaded</span>}
              {lastResult.downloaded > 0 && <span className="text-emerald-400">{lastResult.downloaded} downloaded</span>}
              {lastResult.deleted > 0 && <span className="text-red-400">{lastResult.deleted} deleted</span>}
              <span className="text-foreground">{lastResult.skipped} skipped</span>
              {lastResult.errors.length > 0 && <span className="text-amber-400">{lastResult.errors.length} errors</span>}
            </div>
            {lastResult.errors.length > 0 && (
              <div className="space-y-1 mt-2">
                {lastResult.errors.map((err, i) => (
                  <p key={i} className="typo-caption text-red-400/70">{err}</p>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Info card */}
      {!driveConnected && (
        <SectionCard title="How it works" status="info">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="typo-caption text-blue-400 font-medium">1</span>
              </div>
              <div>
                <p className="typo-heading typo-card-label">Connect Google Drive</p>
                <p className="typo-caption text-foreground">Grant Personas access to create files in your Drive. Only the app&apos;s own folder is accessible.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="typo-caption text-blue-400 font-medium">2</span>
              </div>
              <div>
                <p className="typo-heading typo-card-label">Push your vault</p>
                <p className="typo-caption text-foreground">Vault notes are uploaded as markdown files to Drive. Only changed files are synced (content-hash comparison).</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="typo-caption text-blue-400 font-medium">3</span>
              </div>
              <div>
                <p className="typo-heading typo-card-label">Sync across devices</p>
                <p className="typo-caption text-foreground">Pull on another device to download. Your 15 GB free Google Drive storage is more than enough for thousands of notes.</p>
              </div>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
