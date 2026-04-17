import { useState } from 'react';
import { History, Play, Trash2, CheckCircle2, XCircle, Square as SquareIcon, Loader2, ChevronRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreativeSessionRecord } from '@/stores/slices/system/artistSlice';

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function StatusIcon({ status }: { status: CreativeSessionRecord['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3 h-3 text-rose-400 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
    case 'failed':
      return <XCircle className="w-3 h-3 text-red-400" />;
    case 'cancelled':
      return <SquareIcon className="w-3 h-3 text-amber-400" />;
  }
}

/**
 * Collapsible history panel listing recent creative sessions. Clicking Replay
 * loads the archived output back into the live panel. Delete removes the
 * record (persisted history; no tombstone needed).
 */
export default function CreativeSessionHistory() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const sessions = useSystemStore((s) => s.creativeSessions);
  const replay = useSystemStore((s) => s.loadCreativeSessionIntoOutput);
  const remove = useSystemStore((s) => s.deleteCreativeSessionRecord);

  if (sessions.length === 0 && !expanded) {
    return null;
  }

  const statusLabel = (status: CreativeSessionRecord['status']): string => {
    switch (status) {
      case 'running':
        return t.plugins.artist.session_status_running;
      case 'completed':
        return t.plugins.artist.session_status_completed;
      case 'failed':
        return t.plugins.artist.session_status_failed;
      case 'cancelled':
        return t.plugins.artist.session_status_cancelled;
    }
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-card/50 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/20 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-rose-400" />
          <h3 className="typo-section-title">{t.plugins.artist.session_history}</h3>
          <span className="text-md text-foreground tabular-nums">({sessions.length})</span>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-primary/5">
          {sessions.length === 0 ? (
            <p className="text-md text-foreground py-4 text-center">
              {t.plugins.artist.session_history_empty}
            </p>
          ) : (
            <ul className="space-y-1 mt-2 max-h-72 overflow-y-auto">
              {sessions.map((sess) => (
                <li
                  key={sess.id}
                  className="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/30 transition-colors"
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <StatusIcon status={sess.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-md text-foreground truncate">
                      {sess.prompt || '(empty prompt)'}
                    </p>
                    <div className="flex items-center gap-2 text-md text-foreground">
                      <span>{formatRelative(sess.startedAt)}</span>
                      <span>&middot;</span>
                      <span>{statusLabel(sess.status)}</span>
                      {sess.tools.length > 0 && (
                        <>
                          <span>&middot;</span>
                          <span className="truncate">
                            {t.plugins.artist.session_tools_label} {sess.tools.join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => replay(sess.id)}
                      className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                      title={t.plugins.artist.replay_session}
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => remove(sess.id)}
                      className="p-1 rounded hover:bg-red-500/20 text-red-400"
                      title={t.plugins.artist.delete_session}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
