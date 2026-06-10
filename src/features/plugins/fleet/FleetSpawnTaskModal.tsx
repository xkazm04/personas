import { useState } from 'react';
import { X, Play, ListTodo } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Spawn-with-a-first-task composer. A plain Spawn lands a bare `claude`
 * prompt the operator then has to click into and type at; this variant
 * passes the task as a positional argv (`claude "<task>"`), so the fresh
 * session starts working the moment it boots — one motion instead of three.
 *
 * Presentation only: the actual spawn (and the one-per-cwd error surface)
 * stays with the grid page's handler.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Root path the session will spawn at (shown so the target is unambiguous). */
  projectPath: string;
  /** Spawn a session seeded with this first prompt. Resolves true on success
   *  (errors are toasted by the caller; false keeps the draft for a retry). */
  onSpawn: (prompt: string) => Promise<boolean>;
}

export function FleetSpawnTaskModal({ open, onClose, projectPath, onSpawn }: Props) {
  const { t, tx } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const ok = await onSpawn(text);
      if (ok) {
        setPrompt('');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="fleet-spawn-task-title"
      size="md"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-5 shadow-elevation-4"
    >
      <div data-testid="fleet-spawn-task-modal">
        <div className="flex items-center justify-between mb-2">
          <h2 id="fleet-spawn-task-title" className="typo-section-title flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-primary" aria-hidden="true" />
            {t.plugins.fleet.spawn_task_title}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="mb-3 text-[13px] text-foreground">
          {tx(t.plugins.fleet.spawn_task_desc, { path: projectPath })}
        </p>
        <textarea
          data-testid="fleet-spawn-task-text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
          }}
          placeholder={t.plugins.fleet.spawn_task_placeholder}
          rows={4}
          autoFocus
          className="w-full resize-y rounded-input border border-primary/10 bg-secondary/40 px-2.5 py-2 text-[14px] text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        />
        <div className="mt-3 flex justify-end">
          <Button
            data-testid="fleet-spawn-task-submit"
            variant="primary"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            disabled={!prompt.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? t.plugins.fleet.spawn_task_spawning : t.plugins.fleet.spawn_task_submit}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
