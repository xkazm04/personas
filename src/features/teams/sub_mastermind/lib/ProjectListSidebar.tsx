// Left project sidebar — hidden by default, expands from an icon button on the
// canvas with a linear fade+slide (round-14 motion pass). Lists every project
// (name asc) with a show/hide-in-canvas toggle; the header creates a new project
// through the same ProjectModal mechanism the Projects manager uses.
//
// WHERE IT OPENS (round-15): this is a project navigator, and the app already
// has a slot for exactly that — the 2nd-level sidebar. So rather than floating a
// second nav panel on top of the map beside the real one, it PORTALS INTO the
// L2 container and covers it for as long as it is open. Docking into the element
// (rather than fixed-positioning over a measured rect) means the browser owns
// the geometry: sidebar collapse, tier width changes and the mobile drawer all
// keep working with no offsets of our own. When there is no L2 to take over
// (collapsed rail) it falls back to the in-canvas overlay it used to be.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { STATE_INK } from './ink';
import type { Island } from './types';

const LINEAR = { duration: 0.2, ease: 'linear' as const };

/**
 * The app's 2nd-level sidebar container, while this panel is open — or null when
 * the current chrome has none (collapsed rail), which is the signal to fall back
 * to the in-canvas overlay.
 *
 * Re-resolved on L1's child list changing, which is exactly when L2 mounts or
 * unmounts (collapse toggle, a section with no sub-nav). Without that, collapsing
 * the sidebar mid-open would leave the panel portaled into a detached node and it
 * would vanish with no way back.
 *
 * Resolved for the whole lifetime of the canvas rather than only while the panel
 * is open: which surface we are going to open into has to be known BEFORE the
 * open, or the first frame renders the in-canvas fallback and then swaps — and
 * with `AnimatePresence` on both branches that swap is a visible ghost panel
 * sliding off the map.
 */
function useLevel2Host(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const resolve = () => setHost(document.querySelector<HTMLElement>('[data-sidebar-l2]'));
    resolve();
    const nav = document.querySelector('nav[aria-label="Primary"]');
    if (!nav) return;
    const mo = new MutationObserver(resolve);
    mo.observe(nav, { childList: true });
    return () => mo.disconnect();
  }, []);
  return host;
}

export function ProjectListSidebar({ islands, hidden, open, onOpenToggle, onToggleVisible, onNewProject, onProjectOpen }: {
  /** ALL islands (including canvas-hidden ones), any order. */
  islands: Island[];
  hidden: ReadonlySet<string>;
  open: boolean;
  onOpenToggle: () => void;
  onToggleVisible: (slug: string) => void;
  onNewProject: () => void;
  /** Row (name) clicked — open the project sidebar, same as a header tap. */
  onProjectOpen: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const host = useLevel2Host();
  const panelRef = useRef<HTMLElement | null>(null);
  const sorted = [...islands].sort((a, b) => a.name.localeCompare(b.name));

  // Esc gives the covered nav back. The panel hides a primary navigation
  // surface, so it must not be dismissable only by finding one small button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenToggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenToggle]);

  // Covering a nav visually does not silence it: the section list is still in
  // the DOM underneath, so a keyboard user would tab straight into controls
  // they cannot see. `inert` takes the covered content out of the tab order and
  // the accessibility tree for exactly as long as we sit on top of it.
  //
  // Our own node is excluded by IDENTITY, never by looking for a marker
  // attribute on it: an earlier attribute-based version inerted the panel
  // itself the moment the marker didn't resolve, which silently made the whole
  // project list unclickable. If the ref somehow isn't populated we skip the
  // pass entirely — losing the a11y nicety is recoverable, disabling the panel
  // the user just opened is not.
  useEffect(() => {
    if (!open || !host) return;
    const own = panelRef.current;
    if (!own) return;
    const covered = Array.from(host.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== own,
    );
    for (const el of covered) el.setAttribute('inert', '');
    return () => { for (const el of covered) el.removeAttribute('inert'); };
  }, [open, host]);

  // Panel chrome + rows are the 2nd-level sidebar's own vocabulary (surface,
  // header band, row typography, scrollbar) so the takeover reads as the same
  // menu showing different content — not as a foreign panel dropped on top.
  const body = (
    <div className="flex flex-col h-full bg-secondary/30">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-primary/10 bg-primary/5">
        <h2 className="typo-label text-foreground/90">{t.mastermind.projects_title}</h2>
        <span className="typo-caption text-foreground/50 tabular-nums">{sorted.length}</span>
        <button
          type="button"
          onClick={onNewProject}
          aria-label={t.mastermind.new_project}
          title={t.mastermind.new_project}
          className="ml-auto p-1 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-projects-new"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenToggle}
          aria-label={t.mastermind.projects_close}
          title={t.mastermind.projects_close}
          className="p-1 rounded-interactive text-foreground/70 hover:text-foreground hover:bg-secondary/40 transition-colors focus-ring"
          data-testid="mm-projects-close"
        >
          <PanelLeftClose className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent">
        {sorted.map((i) => {
          const isHidden = hidden.has(i.slug);
          return (
            <li key={i.slug}>
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading font-normal transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground ${isHidden ? 'opacity-50' : ''}`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATE_INK[i.state] }} aria-hidden />
                <button
                  type="button"
                  onClick={() => onProjectOpen(i.slug)}
                  className="truncate flex-1 text-left focus-ring rounded-interactive"
                  data-testid={`mm-project-open-${i.slug}`}
                >
                  {i.name}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleVisible(i.slug)}
                  aria-label={isHidden ? t.mastermind.show_in_canvas : t.mastermind.hide_from_canvas}
                  aria-pressed={!isHidden}
                  title={isHidden ? t.mastermind.show_in_canvas : t.mastermind.hide_from_canvas}
                  className="p-1 rounded-interactive text-foreground/55 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
                  data-testid={`mm-project-visibility-${i.slug}`}
                >
                  {isHidden ? <EyeOff className="w-3.5 h-3.5" aria-hidden /> : <Eye className="w-3.5 h-3.5" aria-hidden />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

  // `bg-background` under the body on BOTH branches: docked, it is what actually
  // hides the nav underneath (a translucent takeover would let the menu it
  // replaced ghost through); floating, it is the same darker-than-the-sea value
  // the rest of the canvas chrome now uses.
  const docked = (
    <motion.aside
      key="mm-projects-docked"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={LINEAR}
      ref={panelRef}
      className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-background"
      aria-label={t.mastermind.projects_title}
      data-testid="mm-projects-sidebar"
    >
      {body}
    </motion.aside>
  );

  const floating = (
    <motion.aside
      key="mm-projects-floating"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={LINEAR}
      className="absolute top-0 left-0 bottom-0 w-[248px] z-20 flex flex-col overflow-hidden bg-background border-r border-primary/15 shadow-elevation-4"
      aria-label={t.mastermind.projects_title}
      data-testid="mm-projects-sidebar"
    >
      {body}
    </motion.aside>
  );

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={LINEAR}
            onClick={onOpenToggle}
            aria-label={t.mastermind.projects_open}
            title={t.mastermind.projects_open}
            className="absolute top-3 left-3 z-10 p-2 rounded-interactive mm-chrome surface-blur-tooltip text-foreground/65 hover:text-foreground hover:bg-primary/12 transition-colors focus-ring"
            data-testid="mm-projects-open"
          >
            <PanelLeftOpen className="w-4 h-4" aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>

      {host
        ? createPortal(<AnimatePresence>{open && docked}</AnimatePresence>, host)
        : <AnimatePresence>{open && floating}</AnimatePresence>}
    </>
  );
}
