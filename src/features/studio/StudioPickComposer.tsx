import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsDown, ChevronsUp, Crosshair, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { guideStrings } from './guide/guideCopy';
import { QUEUED_NOTES_MAX, useStudioStore } from './studioStore';
import type { StudioPreviewState } from './useStudioPreview';

const WIDTH = 340;
const HEIGHT = 150;

// Inspect and change: the owner right-clicked an element in the preview (or
// chose it in inspect mode) and says what should change. The page draws the
// frames (the element, the components wrapping it, its children); this box
// names them as a trail, steps wider or narrower (Alt+Up / Alt+Down, or [ and ]
// inside the page), and keeps what was typed while the target moves. The note
// goes to Athena with the element attached: now when she is idle, else it
// waits for her next step.
export default function StudioPickComposer({ preview }: { preview: StudioPreviewState }) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const sendAimed = useStudioStore((s) => s.sendAimed);
  const { pick, clearPick, picking, startPickMode, moveInspect, activeId, live } = preview;
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'queued' | 'full'>('idle');
  const boxRef = useRef<HTMLFormElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const parent = boxRef.current?.parentElement;
    if (parent) setRoom({ w: parent.clientWidth, h: parent.clientHeight });
  }, [pick]);
  // A new target keeps the words; closing the box clears them.
  useEffect(() => {
    if (!pick) {
      setText('');
      setStatus('idle');
    }
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
  const chain = pick.chain.length ? pick.chain : [pick.tag];
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
    <form
      ref={boxRef}
      aria-label={t.studio.pick_prompt}
      data-testid="studio-pick-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="absolute z-30 flex flex-col gap-2 rounded-card border border-primary/50 bg-background p-3 shadow-elevation-3"
      style={{ left, top, width: WIDTH }}
    >
      <div className="flex items-start gap-2">
        <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <nav aria-label={t.studio.pick_frames} className="min-w-0 flex-1">
          <ol className="flex flex-wrap items-center gap-1" data-testid="studio-pick-chain">
            {chain.map((name, i) => (
              <li
                key={`${i}-${name}`}
                aria-current={i === chain.length - 1 ? 'true' : undefined}
                className={`rounded-interactive px-1.5 typo-label ${
                  i === chain.length - 1 ? 'bg-primary/15 text-primary' : 'text-foreground/90'
                }`}
              >
                {name}
              </li>
            ))}
          </ol>
          <p className="mt-0.5 truncate typo-caption">
            {pick.label ? `"${pick.label}" · ${pick.path}` : pick.path}
          </p>
        </nav>
        <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={clearPick}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <input
        autoFocus
        data-testid="studio-pick-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            moveInspect(e.key === 'ArrowUp' ? 'out' : 'in');
          }
        }}
        placeholder={t.studio.pick_prompt}
        aria-label={t.studio.pick_prompt}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className="w-full rounded-input border border-border bg-secondary/40 px-3 py-2 typo-body text-foreground outline-none focus:border-primary/60"
      />
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" icon={<ChevronsUp className="h-3.5 w-3.5" />} aria-keyshortcuts="Alt+ArrowUp" onClick={() => moveInspect('out')}>
          {t.studio.pick_wider}
        </Button>
        <Button variant="ghost" size="xs" icon={<ChevronsDown className="h-3.5 w-3.5" />} aria-keyshortcuts="Alt+ArrowDown" onClick={() => moveInspect('in')}>
          {t.studio.pick_narrower}
        </Button>
      </div>
      <p role="status" className={status === 'idle' ? 'sr-only' : `typo-caption ${status === 'full' ? 'text-status-warning' : 'text-foreground'}`}>
        {status === 'queued' ? t.studio.pick_queued : status === 'full' ? tx(g.notes_full, { max: QUEUED_NOTES_MAX }) : null}
      </p>
    </form>
  );
}
