import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { webbuildListVersions, webbuildRestoreVersion } from '@/api/webbuild';
import { toastCatch } from '@/lib/silentCatch';
import type { BuildVersion } from '@/lib/bindings/BuildVersion';

// C7 — version history: each build turn commits a snapshot; this lists them and
// restores the project's files to a chosen one (git history is kept, so it's a
// safe "go back to how it looked then"). After a restore the preview reloads.
export default function StudioVersions({ id, onRestored }: { id: string; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<BuildVersion[]>([]);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        setVersions(await webbuildListVersions(id));
      } catch (e) {
        toastCatch('load versions')(e);
      } finally {
        setLoading(false);
      }
    }
  };

  const restore = async (sha: string) => {
    try {
      await webbuildRestoreVersion(id, sha);
      setOpen(false);
      onRestored();
    } catch (e) {
      toastCatch('restore version')(e);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label="Version history"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-foreground/70 shadow-elevation-2 backdrop-blur hover:text-foreground"
      >
        <History className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 max-h-72 w-64 overflow-y-auto rounded-modal border border-border bg-background/95 p-1.5 shadow-elevation-4 backdrop-blur">
          {loading ? (
            <p className="px-2 py-1.5 typo-caption">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="px-2 py-1.5 typo-caption">No versions yet.</p>
          ) : (
            versions.map((v, i) => (
              <button
                key={v.sha}
                type="button"
                onClick={() => void restore(v.sha)}
                className="group flex w-full items-start gap-2 rounded-interactive px-2 py-1.5 text-left transition-colors hover:bg-secondary/60"
              >
                <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40 group-hover:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">
                    {v.message.replace(/^athena:\s*/, '') || (i === 0 ? 'Latest' : v.sha)}
                  </span>
                  <span className="block text-[10px] text-foreground/40">{v.when}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
