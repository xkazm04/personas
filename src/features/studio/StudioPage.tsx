import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Plus, RotateCcw, Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevServerStatus } from '@/lib/bindings/DevServerStatus';
import { toastCatch } from '@/lib/silentCatch';
import {
  webbuildDevStart,
  webbuildDevStop,
  webbuildListProjects,
  webbuildScaffold,
  webbuildStatus,
} from '@/api/webbuild';
import StudioChecklist from './StudioChecklist';
import StudioChatInput from './StudioChatInput';

// Dev-only experimental surface — P1 of the Athena web-dev companion
// (docs/plans/athena-webdev-companion-v0.md). Copy is a local constant;
// i18n is deferred to consolidation to avoid en.json churn while the surface
// is in flux (same pattern as the /prototype sessions).
const COPY = {
  title: 'Studio',
  newPlaceholder: 'New project name…',
  create: 'Create & preview',
  stop: 'Stop',
  reload: 'Reload',
  starting: 'Starting the dev server…',
  scaffolding: 'Scaffolding with Bun — this can take a minute…',
  idleHint: 'Pick or create a project, then start its dev server to preview it here.',
  noProjects: 'No projects yet — create one to begin.',
};

type Phase = 'idle' | 'scaffolding' | 'starting' | 'live' | 'error';

export default function StudioPage() {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<DevServerStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [newName, setNewName] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await webbuildListProjects());
    } catch (e) {
      toastCatch('load projects')(e);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    return stopPolling;
  }, [refreshProjects, stopPolling]);

  const beginPolling = useCallback(
    (projectId: string) => {
      stopPolling();
      pollRef.current = window.setInterval(() => {
        webbuildStatus(projectId)
          .then((s) => {
            setStatus(s);
            if (s?.healthy) {
              setPhase('live');
              stopPolling();
            }
          })
          .catch(() => {
            /* transient while the server boots — keep polling */
          });
      }, 1500);
    },
    [stopPolling],
  );

  const start = useCallback(
    async (projectId: string) => {
      setSelectedId(projectId);
      setPhase('starting');
      setStatus(null);
      try {
        setStatus(await webbuildDevStart(projectId));
        beginPolling(projectId);
      } catch (e) {
        setPhase('error');
        toastCatch('start dev server')(e);
      }
    },
    [beginPolling],
  );

  const stop = useCallback(async () => {
    if (!selectedId) return;
    stopPolling();
    try {
      await webbuildDevStop(selectedId);
    } catch (e) {
      toastCatch('stop dev server')(e);
    }
    setStatus(null);
    setPhase('idle');
  }, [selectedId, stopPolling]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setPhase('scaffolding');
    try {
      const project = await webbuildScaffold(name);
      setNewName('');
      await refreshProjects();
      await start(project.id);
    } catch (e) {
      setPhase('error');
      toastCatch('scaffold project')(e);
    }
  }, [newName, refreshProjects, start]);

  const reload = useCallback(() => setIframeKey((k) => k + 1), []);

  const placeholder =
    phase === 'scaffolding'
      ? COPY.scaffolding
      : phase === 'starting'
        ? COPY.starting
        : projects.length === 0
          ? COPY.noProjects
          : COPY.idleHint;

  const selectedName = projects.find((p) => p.id === selectedId)?.name ?? 'project';

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* Single-row toolbar — scrolls horizontally instead of forcing the
          parent width (the cropping cause). */}
      <header className="flex w-full min-w-0 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border px-4 py-2">
        <Bot className="h-5 w-5 shrink-0 text-primary" />
        <h1 className="typo-title shrink-0">{COPY.title}</h1>

        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
          placeholder={COPY.newPlaceholder}
          className="w-44 shrink-0 rounded-input border border-border bg-secondary/40 px-3 py-1.5 text-md outline-none focus:border-primary/50"
        />
        <Button
          variant="primary"
          size="sm"
          className="shrink-0"
          icon={<Plus className="h-4 w-4" />}
          loading={phase === 'scaffolding'}
          disabled={!newName.trim() || phase === 'scaffolding'}
          onClick={() => void create()}
        >
          {COPY.create}
        </Button>

        {projects.length > 0 && <div className="h-5 w-px shrink-0 bg-border" />}
        {projects.map((p) => (
          <Button
            key={p.id}
            variant={selectedId === p.id ? 'accent' : 'secondary'}
            accentColor="violet"
            size="sm"
            className="shrink-0"
            onClick={() => void start(p.id)}
          >
            {p.name}
          </Button>
        ))}

        {selectedId && (
          <>
            <div className="h-5 w-px shrink-0 bg-border" />
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={reload}
            >
              {COPY.reload}
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="shrink-0"
              icon={<Square className="h-4 w-4" />}
              onClick={() => void stop()}
            >
              {COPY.stop}
            </Button>
            {status?.url && <span className="typo-caption shrink-0">{status.url}</span>}
          </>
        )}
      </header>

      {/* Preview fills all remaining space; min-w-0/min-h-0 + absolute iframe
          guarantee it isn't cropped by the toolbar's content width. */}
      <div className="relative min-h-0 w-full min-w-0 flex-1 bg-black/20">
        {phase === 'live' && status?.healthy ? (
          <iframe
            key={iframeKey}
            src={status.url}
            title="preview"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="typo-caption max-w-sm">{placeholder}</p>
          </div>
        )}
        {selectedId && (
          <>
            <StudioChecklist />
            <StudioChatInput projectId={selectedId} projectName={selectedName} />
          </>
        )}
      </div>
    </div>
  );
}
