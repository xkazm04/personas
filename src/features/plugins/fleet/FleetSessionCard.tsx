import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { killSession, removeSession, renameSession } from '@/api/fleet/fleet';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { FleetStatusDots } from './FleetStatusDots';
import { FleetStateSparkline } from './FleetStateSparkline';
import { debtText } from '@/i18n/DebtText';
import { useTranslation } from '@/i18n/useTranslation';
import { useNowTick, formatAgo } from './relativeAgo';


/**
 * Compact one-row session card for the left panel.
 *
 * Surfaces only what scales to a list of 5-10 parallel sessions:
 *   [● ●] project-name · custom-name           [✎] [×]
 *
 * The two dots are the {console, business} state pair (see FleetStatusDots).
 * Clicking anywhere on the row (outside the action buttons) focuses the
 * session in the right pane. Hovering the row reveals an edit pencil + an
 * X close button:
 *   - ✎ → click to enter inline-edit mode for the per-session name
 *         (Enter to save, Esc to cancel, blur to save)
 *   - × → kill (if alive) or drop (if exited)
 *
 * Memoized — when other sessions update, this card's props are unchanged
 * (slice patchSession preserves untouched session object identities) and
 * React.memo bails the render.
 */
interface Props {
  session: FleetSession;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRemovedLocal: (id: string) => void;
}

function FleetSessionCardImpl({ session, isActive, onActivate, onRemovedLocal }: Props) {
  const patchSession = useSystemStore((s) => s.fleetPatchSession);
  const transitions = useSystemStore((s) => s.fleetTransitions[session.id]);
  const { t } = useTranslation();
  const now = useNowTick();

  // State provenance — WHY the row shows this state, from the three signals
  // the backend derives state from (hooks, PTY output, transcript growth).
  // Rides the status-dot tooltip so diagnosing a mislabeled session no
  // longer needs PERSONAS_FLEET_DEBUG and a dev console.
  const f = t.plugins.fleet;
  const sig = (ms: bigint | number) =>
    Number(ms) > 0 ? formatAgo(t, Number(ms), now) : f.provenance_never;
  const provenance = [
    session.stateReason,
    `${f.provenance_hook_activity} ${sig(session.lastActivityMs)}`,
    `${f.provenance_console} ${sig(session.lastPtyOutputMs)}`,
    `${f.provenance_transcript} ${sig(session.lastGrewMs)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input as soon as we enter edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleOpen = useCallback(() => {
    // Click on the row body activates; the edit + close actions stopPropagation.
    if (!editing) onActivate(session.id);
  }, [session.id, onActivate, editing]);

  const handleClose = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (session.state === 'exited' || session.state === 'hibernated') {
          // No live process — just drop the row (the placeholder).
          await removeSession(session.id);
          onRemovedLocal(session.id);
        } else {
          await killSession(session.id);
        }
      } catch (err) {
        toastCatch('FleetSessionCard:close', 'Failed to close session')(err);
      }
    },
    [session.id, session.state, onRemovedLocal],
  );

  const beginEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(session.name ?? '');
    setEditing(true);
  }, [session.name]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
  }, []);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    const next = draft.trim() === '' ? null : draft.trim();
    if (next === (session.name ?? null)) return; // no-op
    // Optimistic local patch — the registry round-trip will arrive via
    // FLEET_REGISTRY_CHANGED → fleetRefresh anyway, but updating now
    // keeps the row from flickering back to the old value.
    patchSession(session.id, { name: next });
    try {
      await renameSession(session.id, next);
    } catch (e) {
      silentCatch('FleetSessionCard:rename')(e);
      // Revert optimistic patch on failure.
      patchSession(session.id, { name: session.name ?? null });
    }
  }, [draft, session.id, session.name, patchSession]);

  return (
    <button
      type="button"
      onClick={handleOpen}
      data-testid={`fleet-session-row-${session.id}`}
      data-active={isActive || undefined}
      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-card border transition-colors text-left ${
        isActive
          ? 'border-primary/30 bg-primary/8'
          : 'border-transparent hover:border-primary/15 hover:bg-secondary/30'
      }`}
      title={session.cwd}
    >
      <FleetStatusDots state={session.state} reason={provenance} />

      {/* Label area — either the static "project · name" or the inline edit input. */}
      {editing ? (
        <input
          ref={inputRef}
          data-testid={`fleet-session-rename-input-${session.id}`}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => commitEdit()}
          placeholder={debtText("auto_name_d84da4a2")}
          className="typo-caption font-medium flex-1 min-w-0 bg-background border border-primary/30 rounded px-1.5 py-0 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      ) : (
        <span className="typo-caption font-medium truncate flex-1 min-w-0 flex items-baseline gap-1.5">
          <span className="truncate">{session.projectLabel}</span>
          {session.name && (
            <>
              <span className="text-foreground select-none">·</span>
              <span
                className="text-foreground italic truncate min-w-0"
                data-testid={`fleet-session-name-${session.id}`}
              >
                {session.name}
              </span>
            </>
          )}
        </span>
      )}

      {/* Actions — only render the buttons when not editing to keep the
          inline input full-width. */}
      {!editing && transitions && <FleetStateSparkline transitions={transitions} />}

      {!editing && (
        <>
          <span
            role="button"
            tabIndex={0}
            aria-label={session.name ? 'Rename session' : 'Add session name'}
            title={session.name ? 'Rename session' : 'Add session name'}
            onClick={beginEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                beginEdit(e as unknown as React.MouseEvent);
              }
            }}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-primary transition-opacity p-0.5 rounded flex-shrink-0"
            data-testid={`fleet-session-rename-${session.id}`}
          >
            <Pencil className="w-3 h-3" />
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label={session.state === 'exited' || session.state === 'hibernated' ? 'Remove from list' : 'Kill session'}
            onClick={handleClose}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClose(e as unknown as React.MouseEvent);
              }
            }}
            className="opacity-40 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5 rounded -mr-0.5 flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </span>
        </>
      )}
    </button>
  );
}

export const FleetSessionCard = memo(FleetSessionCardImpl, (prev, next) =>
  prev.session === next.session &&
  prev.isActive === next.isActive &&
  prev.onActivate === next.onActivate &&
  prev.onRemovedLocal === next.onRemovedLocal,
);
