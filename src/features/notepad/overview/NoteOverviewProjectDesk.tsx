import { useMemo, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Badge } from '@/features/shared/components/display/Badge';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

import { noteStatusMeta } from '../noteStatusMeta';
import { resultSummary } from '../noteText';
import { NoteCardFooter, ProjectLabel } from './parts/NoteCardBits';
import { NoteQuickWrite } from './parts/NoteQuickWrite';
import { OVERVIEW_COPY } from './prototypeCopy';
import type { NoteOverviewProps } from './types';

const ALL = '__all';
const NONE = '__none';

/**
 * DIRECTION 3 — "Project desk".
 *
 * A note in this app is thinking ABOUT a repository, so the desk is organised
 * by repository: a filter strip of the projects your notes point at, and a
 * capture line on top that drops a draft straight into whichever project is
 * selected — Enter and it is on the desk. Each card leads with its project as
 * the eyebrow, carries its state as a colour edge along the top plus a badge,
 * and a completed note shows what came back from its run instead of hiding it
 * one click away.
 *
 * The bet: capture is the hot path, and "what is going on in project X" is the
 * question the overview should answer.
 */
export default function NoteOverviewProjectDesk({
  notes,
  projects,
  saveStates,
  atCap,
  focusNoteId,
  onOpen,
  onPatch,
  onCreate,
}: NoteOverviewProps) {
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
    <div className="flex flex-col gap-5">
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
          placeholder={atCap ? tx(t.notepad.cap_reached, { count: notes.length }) : OVERVIEW_COPY.capture_placeholder}
          aria-label={OVERVIEW_COPY.capture_placeholder}
          data-testid="notepad-overview-capture"
          className="flex-1 min-w-0 h-12 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/50 outline-none disabled:is-disabled"
        />
        <CornerDownLeft className="w-4 h-4 text-foreground/40" aria-hidden />
      </form>

      {tabs.length > 2 && (
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

      <div className="grid grid-cols-4 gap-4">
        {visible.map((note, index) => {
          const meta = noteStatusMeta(note.status);
          const summary = note.status === 'completed' ? resultSummary(note.resultJson) : null;
          return (
            <RevealItem
              key={note.id}
              revealId={note.id}
              order={index}
              {...enter}
              data-testid={`notepad-card-${note.id}`}
              className={`group relative overflow-hidden min-h-52 flex flex-col gap-2.5 px-4 pt-4 pb-3 rounded-card border ${meta.tone.border} ${meta.tone.wash} hover:shadow-elevation-2 transition-shadow`}
            >
              <span className={`absolute inset-x-0 top-0 h-0.5 ${meta.tone.fill}`} aria-hidden />

              <div className="flex items-center justify-between gap-2">
                <ProjectLabel projectId={note.projectId} projects={projects} className="typo-label" />
                <Badge variant={meta.badgeVariant} size="sm">
                  <meta.Icon className="w-3 h-3" aria-hidden />
                  {meta.labelKey(t)}
                </Badge>
              </div>

              <button type="button" onClick={() => onOpen(note.id)} className="text-left rounded-input focus-ring">
                <span className="block typo-title-lg text-foreground line-clamp-2">{note.title}</span>
              </button>

              {summary ? (
                <button type="button" onClick={() => onOpen(note.id)} className="flex-1 min-h-0 text-left rounded-input focus-ring">
                  <span className={`block typo-label mb-1 ${meta.tone.text}`}>{t.notepad.result_title}</span>
                  <span className="typo-body text-foreground/85 line-clamp-3">{summary}</span>
                </button>
              ) : (
                <NoteQuickWrite
                  note={note}
                  toolbarReveal="hover"
                  onPatch={(patch) => onPatch(note.id, patch)}
                  onOpen={() => onOpen(note.id)}
                  autoFocus={note.id === focusNoteId}
                />
              )}

              <NoteCardFooter note={note} saveState={saveStates[note.id] ?? 'clean'} onOpen={() => onOpen(note.id)} />
            </RevealItem>
          );
        })}
      </div>
    </div>
  );
}
