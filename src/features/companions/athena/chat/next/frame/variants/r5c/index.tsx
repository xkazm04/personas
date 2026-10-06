/**
 * R5 · C — "Folio". Words first: the screen is a page and Athena writes in its
 * margins. At rest there are two pieces of type and nothing else: a RUNNING
 * LINE at the foot of the screen (her mark, the conversation, one whole
 * sentence of her latest reply, an ink drop for unread words) and a ruled
 * MARGIN on the right edge (a footnote mark per item waiting on you, in its
 * kind's ink, and each project's runs as a spine label with a shape per state).
 *
 * The same objects open in place: the running line widens into the page's last
 * line (the composer) and the page unrolls upward from it; the margin's marks
 * fly into the folio's contents when decisions open (Alt+W), and its spine
 * labels unfold into margin notes (Alt+M). Esc folds back, one level at a time.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useCallback, useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { RefOpenerProvider } from '../../../../refs/RefOpenerContext';
import { useLayer } from '../../../useLayer';
import { useLayerRefOpener } from '../../../useLayerRefOpener';
import { useProcessColumns } from '../../../useProcessColumns';
import { useWorkforce } from '../../../useWorkforce';
import { FOLIO_COPY as C } from './copy';
import { Folio } from './Folio';
import { Foot } from './Foot';
import { Margin } from './Margin';
import { MarginNotes } from './MarginNotes';
import { footnoteMark } from './marks';
import { PageSheet } from './PageSheet';
import './folio.css';

function focusComposer() {
  requestAnimationFrame(() =>
    document.querySelector<HTMLTextAreaElement>('.r5c [data-testid="companion-input"]')?.focus(),
  );
}

function isField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function R5CFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.her);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const [pageOpen, setPageOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [footH, setFootH] = useState(52);

  const folioOpen = view.kind === 'work' && !brainOpen;
  const focusId = view.kind === 'work' ? (view.focus ?? workforce.items[0]?.id ?? null) : null;
  const aboutAt = folioOpen ? workforce.items.findIndex((i) => i.id === focusId) : -1;
  const about = aboutAt >= 0 ? { item: workforce.items[aboutAt]!, mark: footnoteMark(aboutAt) } : null;
  const sheetOpen = pageOpen || brainOpen || view.kind === 'report';

  const openPage = useCallback(() => {
    setPageOpen(true);
    setNotesOpen(false);
    focusComposer();
  }, []);
  const openItem = useCallback(
    (id: string | null) => {
      setNotesOpen(false);
      layer.openWork(id, null);
    },
    [layer],
  );

  // Alt+A writes to her, Alt+M reads the margin notes, Esc folds one level.
  // Below useLayer's rung, so an open folio takes Esc first.
  useAppKeyboard(
    (e) => {
      const key = e.key.toLowerCase();
      if (e.altKey && key === 'a') {
        e.preventDefault();
        const inComposer = document.activeElement?.closest('[data-testid="companion-composer"]');
        if (pageOpen && inComposer) setPageOpen(false);
        else openPage();
        return true;
      }
      if (e.altKey && key === 'm') {
        e.preventDefault();
        setNotesOpen((o) => !o);
        return true;
      }
      if (e.key !== 'Escape') return false;
      const el = document.activeElement;
      if (isField(el) && el.value) return false;
      if (notesOpen) {
        setNotesOpen(false);
        return true;
      }
      if (pageOpen) {
        setPageOpen(false);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY - 1 },
  );

  return (
    <RefOpenerProvider value={refOpener}>
      <LayoutGroup id="r5c">
        <div
          className={`r5c fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none`}
          style={{ ['--r5c-foot-h' as string]: `${footH}px` }}
          data-testid="companion-panel"
          data-chat-variant="r5c"
        >
          <PageSheet
            open={sheetOpen}
            engine={engine}
            view={view}
            onBack={layer.back}
            onFold={() => setPageOpen(false)}
            onOpenWaiting={() => openItem(null)}
            waiting={workforce.counts.waiting}
          />
          <MarginNotes
            open={notesOpen && !folioOpen}
            items={workforce.items}
            columns={columns}
            threads={workforce.threads}
            onOpenItem={openItem}
            onClose={() => setNotesOpen(false)}
          />
          <Margin
            hidden={folioOpen}
            items={workforce.items}
            columns={columns}
            notesOpen={notesOpen && !folioOpen}
            onOpenItem={openItem}
            onToggleNotes={() => setNotesOpen((o) => !o)}
          />
          <Folio
            open={folioOpen}
            items={workforce.items}
            columns={columns}
            focusId={focusId}
            onFocus={(id) => layer.openWork(id, null)}
            onClose={layer.back}
            onSend={engine.send}
          />
          <Foot
            engine={engine}
            mode={pageOpen || folioOpen ? 'write' : 'rest'}
            about={about}
            onClearAbout={layer.back}
            onOpen={openPage}
            onHeight={setFootH}
            joined={sheetOpen}
          />
        </div>
      </LayoutGroup>
    </RefOpenerProvider>
  );
}

export default R5CFrame;
