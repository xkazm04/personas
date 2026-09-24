import { useLayoutEffect, useRef, useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { guideStrings } from './guide/guideCopy';
import { QUEUED_NOTES_MAX, useStudioStore } from './studioStore';
import type { StudioPreviewState } from './useStudioPreview';

const WIDTH = 320;
const HEIGHT = 124;

// Right-click targeting: the owner right-clicked an element in the preview (or
// clicked it with the Tweak tool) and says what should change. The note goes
// to Athena with the element attached: now when she is idle, else it waits for
// her next step. Drawn over the preview it belongs to, next to the element.
export default function StudioPickComposer({ preview }: { preview: StudioPreviewState }) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const sendAimed = useStudioStore((s) => s.sendAimed);
  const { pick, clearPick, picking, startPickMode, activeId, live } = preview;
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'queued' | 'full'>('idle');
  const boxRef = useRef<HTMLFormElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const parent = boxRef.current?.parentElement;
    if (parent) setRoom({ w: parent.clientWidth, h: parent.clientHeight });
    setText('');
    setStatus('idle');
  }, [pick]);

  const open = !!pick && pick.projectId === activeId && live;
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      if (open) clearPick();
      else startPickMode(false);
      e.preventDefault();
      return true;
    },
    { enabled: open || picking, priority: OVERLAY_DISMISS_PRIORITY },
  );

  if (picking && !open) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
        <p
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-primary/60 bg-background/90 px-3 py-1.5 typo-caption text-foreground shadow-elevation-2"
        >
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          {t.studio.pick_mode_hint}
          <Button variant="ghost" size="xs" onClick={() => startPickMode(false)}>
            {t.common.cancel}
          </Button>
        </p>
      </div>
    );
  }
  if (!open || !pick) return null;

  const r = pick.rect;
  const left = Math.max(8, Math.min(r.x, (room.w || r.x + WIDTH + 8) - WIDTH - 8));
  const below = r.y + r.height + 8;
  const top = below + HEIGHT < (room.h || Infinity) ? below : Math.max(8, r.y - HEIGHT - 8);
  const submit = () => {
    const value = text.trim();
    if (!value || !activeId) return;
    const result = sendAimed(activeId, { selector: pick.selector, label: pick.label, path: pick.path }, value);
    if (result === 'full') {
      setStatus('full');
      return;
    }
    if (result === 'queued') {
      setStatus('queued');
      window.setTimeout(clearPick, 1200);
      return;
    }
    clearPick();
  };

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute z-20 rounded-card ring-2 ring-primary"
        style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
      />
      <form
        ref={boxRef}
        aria-label={t.studio.pick_prompt}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        data-testid="studio-pick-composer"
        className="absolute z-30 flex flex-col gap-2 rounded-card border border-primary/50 bg-background p-3 shadow-elevation-3"
        style={{ left, top, width: WIDTH }}
      >
        <div className="flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate typo-label text-foreground">{pick.label || pick.tag}</span>
          <span className="shrink-0 typo-caption">{pick.path}</span>
          <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={clearPick}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <input
          autoFocus
          data-testid="studio-pick-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.studio.pick_prompt}
          aria-label={t.studio.pick_prompt}
          className="w-full rounded-input border border-border bg-secondary/40 px-3 py-2 typo-body text-foreground outline-none focus:border-primary/60"
        />
        <p role="status" className={status === 'idle' ? 'sr-only' : `typo-caption ${status === 'full' ? 'text-status-warning' : 'text-foreground'}`}>
          {status === 'queued' ? t.studio.pick_queued : status === 'full' ? tx(g.notes_full, { max: QUEUED_NOTES_MAX }) : null}
        </p>
      </form>
    </>
  );
}
