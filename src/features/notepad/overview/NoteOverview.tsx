import { useMemo, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

import { NOTE_CAP } from '../notepadStore';
import { NoteDeskCard } from './NoteDeskCard';
import { OverviewGhost } from './parts/NoteCardBits';
import type { NoteOverviewProps } from './types';

const ALL = '__all';
const NONE = '__none';

/**
 * Layer 1 of the pad — the project desk. Every open note as a card; a card
 * opens layer 2, the full editor (`NoteBody` with its tab strip and dispatch
 * bar).
 *
 * A note in this app is thinking ABOUT a repository, so the desk is organised
 * by repository: a filter strip of the projects the notes point at, and a
 * capture line that drops a draft straight into whichever project is selected.
 *
 * Picked 2026-09-14 out of three directions a `/prototype` round compared
 * (Index cards, Lifecycle board, Project desk). The other two and the switcher
 * were deleted in the same change.
 */
export function NoteOverview({
  loading,
  notes,
  projects,
  saveStates,
  atCap,
  focusNoteId,
  onOpen,
  onPatch,
  onCreate,
}: NoteOverviewProps & { loading: boolean }) {
  const { t, tx } = useTranslation();
  const enter = useRevealTracker();
  const [filter, setFilter] = useState<string>(ALL);
  const [capture, setCapture] = useState('');

  const tabs = useMemo(() => {
    const used = projects.filter((p) => notes.some((n) => n.projectId === p.id));
    const unmapped = notes.filter((n) => !n.projectId).length;
    return [
      { id: ALL, label: `${t.common.all} · ${notes.length}` },
      ...used.map((p) => ({ id: p.id, label: `${p.name} · ${notes.filter((n) => n.projectId === p.id).length}` })),
      ...(unmapped > 0 ? [{ id: NONE, label: `${t.notepad.project_none} · ${unmapped}` }] : []),
    ];
  }, [notes, projects, t]);

  // A filter can outlive its last note (archived, re-mapped) — fall back to All.
  const active = tabs.some((tab) => tab.id === filter) ? filter : ALL;
  const visible = notes.filter((n) =>
    active === ALL ? true : active === NONE ? !n.projectId : n.projectId === active,
  );

  const submitCapture = () => {
    const text = capture.trim();
    if (!text || atCap) return;
    onCreate({ bodyMd: text, projectId: active === ALL || active === NONE ? null : active });
    setCapture('');
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="notepad-overview">
      <div className="px-8 py-6 flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
          <span className="typo-caption text-foreground/60">
            {tx(t.notepad.overview_count, { count: notes.length, cap: NOTE_CAP })}
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCapture();
          }}
          className="flex items-center gap-2 px-4 rounded-card border border-primary/15 bg-secondary/15 focus-within:border-primary/35 transition-colors"
        >
          <input
            type="text"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            disabled={atCap}
            placeholder={atCap ? tx(t.notepad.cap_reached, { count: notes.length }) : t.notepad.overview_capture_placeholder}
            aria-label={t.notepad.overview_capture_placeholder}
            data-testid="notepad-overview-capture"
            className="flex-1 min-w-0 h-12 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/50 outline-none disabled:is-disabled"
          />
          <CornerDownLeft className="w-4 h-4 text-foreground/40" aria-hidden />
        </form>

        {!loading && tabs.length > 2 && (
          <SegmentedTabs
            tabs={tabs}
            activeTab={active}
            onTabChange={setFilter}
            size="sm"
            fullWidth={false}
            ariaLabel={t.notepad.project_label}
            layoutId="notepad-desk-filter"
          />
        )}

        {loading ? (
          <OverviewGhost />
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {visible.map((note, index) => (
              <NoteDeskCard
                key={note.id}
                note={note}
                projects={projects}
                saveState={saveStates[note.id] ?? 'clean'}
                order={index}
                reveal={enter}
                autoFocus={note.id === focusNoteId}
                onOpen={() => onOpen(note.id)}
                onPatch={(patch) => onPatch(note.id, patch)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
