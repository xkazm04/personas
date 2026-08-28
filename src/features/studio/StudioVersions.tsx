import { useCallback, useRef, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { webbuildListVersions, webbuildRestoreVersion } from '@/api/webbuild';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { BuildVersion } from '@/lib/bindings/BuildVersion';

// C7 — version history: each build turn commits a snapshot; this lists them and
// restores the project's files to a chosen one (git history is kept, so it's a
// safe "go back to how it looked then"). After a restore the preview reloads.
//
// Restore is NOT free, and the row used to fire it on a single click. The
// backend runs `git checkout <sha> -- .` over the working tree, so anything
// written since the last turn snapshot — a hand edit, the output of a turn the
// user interrupted with Stop — is overwritten with no copy kept anywhere. Until
// the backend captures the current state before restoring, the confirm step is
// what stands between a mis-click in a dropdown and lost work.
export default function StudioVersions({ id, onRestored }: { id: string; onRestored: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<BuildVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<BuildVersion | null>(null);

  // Escape closes the menu — but never while the restore confirmation is up,
  // where Escape belongs to the dialog. The click-away layer below stays: a
  // cross-origin iframe swallows its own clicks, so a mousedown on the live
  // preview never reaches this document.
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, open && pending === null, close);

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
      setPending(null);
      setOpen(false);
      onRestored();
    } catch (e) {
      // Leave the dialog open on failure so the user sees the toast in context
      // and can retry, rather than silently returning to the preview.
      toastCatch('restore version')(e);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="studio-versions"
        onClick={() => void toggle()}
        aria-label={t.studio.version_history}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/65 transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        <History className="h-4 w-4" />
      </button>
      {/* Click-away dismissal, matching the tab-strip picker. Without it the
          panel could only be closed by finding the history button again — and it
          sits over the live preview, so it blocked the thing the user came to
          look at. Sits BELOW the panel in z-order and above everything else. */}
      {open && (
        <div
          className="fixed inset-0 z-20"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div
          data-testid="studio-versions-panel"
          role="menu"
          className="absolute right-0 top-9 z-30 max-h-72 w-64 overflow-y-auto rounded-modal border border-border bg-background/95 p-1.5 shadow-elevation-4 backdrop-blur"
        >
          {loading ? (
            <p className="px-2 py-1.5 typo-caption">{t.common.loading}</p>
          ) : versions.length === 0 ? (
            <p className="px-2 py-1.5 typo-caption">{t.studio.no_versions_yet}</p>
          ) : (
            versions.map((v, i) => (
              <button
                key={v.sha}
                type="button"
                role="menuitem"
                onClick={() => setPending(v)}
                className="group flex w-full items-start gap-2 rounded-interactive px-2 py-1.5 text-left transition-colors hover:bg-secondary/60"
              >
                <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40 group-hover:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">
                    {v.message.replace(/^athena:\s*/, '') || (i === 0 ? t.studio.latest : v.sha)}
                  </span>
                  <span className="block text-[10px] text-foreground/40">{v.when}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={t.chrome.restore}
          // The version's own commit subject is user-generated content and stays
          // untranslated; the warning around it is not.
          body={`${pending.message.replace(/^athena:\s*/, '') || pending.sha} · ${pending.when}\n\n${t.common.confirm_destructive_cannot_undo}`}
          danger
          confirmLabel={t.chrome.restore}
          onConfirm={() => restore(pending.sha)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
