// The Strata design board — recipes to step through, at the operator's pace.
//
// ROUND 2 of the board changed who drives. The first version rendered every
// cell on mount and only then let you look; the operator asked to switch
// through in their own time. So the stage is LIVE from the first frame,
// showing one recipe with orbit controls, and the arrow keys, the number keys
// and the Previous / Next buttons step through the board. The camera is kept
// across recipe switches on purpose — comparing six looks from the same angle
// is the whole point — and only re-flies when the FRAME changes.
//
// The contact sheet is on demand: Render sheet walks the queue — mount,
// wait ~40 frames for the decks to settle, read the buffer back as JPEG,
// next — and then hands the stage back. Below it the cells appear (click one
// to open it live, star a column to pick it; the picks line is what to paste
// into chat) and a 2D canvas composes them into one sheet that
// `scripts/capture-canvas.mjs` can grab.
//
// One live canvas rather than a grid of them: a ten-project scene is a few
// thousand draw calls, and a board is static until you orbit it.
//
// Dev-only. It lives behind the switcher only in dev builds, and it reads the
// same mock world the prototypes do.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import { MOCK_WORLD } from '../mockWorld';
import { StrataScene } from '../StrataWorld';
import type { WorldFocus } from '../worldModel';
import { CURRENT_BOARD, type DesignRecipe } from './recipes';
import { frameFocus, staticNav } from './staticNav';
import './board.css';

/** Stage size in CSS px. The board renders at DPR 1 so a shot is this size. */
const STAGE_W = 960;
const STAGE_H = 600;
/** Frames to wait before reading the buffer: the camera flight is instant on
 *  first mount, but the decks damp into place over ~30 frames. */
const SETTLE_FRAMES = 40;
/** Recipes per band on the contact sheet. */
const SHEET_PER_ROW = 3;

interface Cell { recipe: DesignRecipe; level: 0 | 1; focus: WorldFocus }
const shotKey = (c: Cell): string => `${c.recipe.id}:${c.level}`;

/** Reads the previous frame's buffer once `frames` frames have elapsed. Runs
 *  inside the Canvas; needs preserveDrawingBuffer on the renderer. */
function Snapshot({ frames, onShot }: { frames: number; onShot: (dataUrl: string) => void }) {
  const gl = useThree((s) => s.gl);
  const n = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    n.current += 1;
    if (n.current >= frames) {
      done.current = true;
      onShot(gl.domElement.toDataURL('image/jpeg', 0.82));
    }
  });
  return null;
}

export default function DesignBoard() {
  const { t, tx } = useTranslation();
  const board = CURRENT_BOARD;
  const { recipes, frames } = board;
  const cells = useMemo<Cell[]>(() => recipes.flatMap((recipe) => frames.map((level) => ({ recipe, level, focus: frameFocus(level) }))), [recipes, frames]);

  const [index, setIndex] = useState(0);
  const [level, setLevel] = useState<0 | 1>(frames[0] ?? 1);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<Cell[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const sheetRef = useRef<HTMLCanvasElement>(null);

  const rendering = queue[0] ?? null;
  const chosen = recipes[index] ?? recipes[0];
  const stage: Cell | null = rendering ?? (chosen ? { recipe: chosen, level, focus: frameFocus(level) } : null);
  const done = cells.length - queue.length;
  const sheetReady = queue.length === 0 && Object.keys(shots).length > 0;

  const step = useCallback((delta: number) => {
    setIndex((i) => (recipes.length === 0 ? 0 : (i + delta + recipes.length) % recipes.length));
  }, [recipes.length]);

  // Arrow keys step, digits jump. Registered on the app's keyboard ladder at
  // route priority so a modal over the board still wins its keys, and
  // declined while a sheet is rendering so the stage cannot be pulled away
  // from under the snapshot.
  useAppKeyboard(
    (e) => {
      if (rendering) return false;
      if (e.key === 'ArrowRight') { step(1); return true; }
      if (e.key === 'ArrowLeft') { step(-1); return true; }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= recipes.length) { setIndex(n - 1); return true; }
      return false;
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );

  const onShot = useCallback((url: string) => {
    setQueue((q) => {
      const head = q[0];
      if (head) setShots((s) => ({ ...s, [shotKey(head)]: url }));
      return q.slice(1);
    });
  }, []);

  const renderSheet = () => { setShots({}); setQueue(cells); };
  const togglePick = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const openCell = (cell: Cell) => {
    const i = recipes.findIndex((r) => r.id === cell.recipe.id);
    if (i >= 0) setIndex(i);
    setLevel(cell.level);
  };

  // Compose the contact sheet once every shot is in. Wrapped into bands of
  // SHEET_PER_ROW recipes, each band carrying every frame row, labelled with
  // id, name and the one-line note. A 2D canvas so the capture script can
  // read it back like any other.
  useEffect(() => {
    if (!sheetReady || !sheetRef.current) return;
    const cols = recipes.length;
    const rows = frames.length;
    const cw = 480; const ch = 300; const label = 44; const gap = 6;
    const perRow = Math.min(cols, SHEET_PER_ROW);
    const bands = Math.ceil(cols / perRow);
    const c = sheetRef.current;
    c.width = perRow * (cw + gap) + gap;
    c.height = bands * rows * (ch + label + gap) + gap;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    recipes.forEach((recipe, col) => {
      frames.forEach((lvl, row) => {
        const url = shots[`${recipe.id}:${lvl}`];
        const band = Math.floor(col / perRow);
        const x = gap + (col % perRow) * (cw + gap);
        const y = gap + (band * rows + row) * (ch + label + gap);
        ctx.fillStyle = '#111317';
        ctx.fillRect(x, y, cw, ch + label);
        ctx.fillStyle = '#e6e2da';
        ctx.font = '600 15px ui-monospace, Consolas, monospace';
        ctx.fillText(`${recipe.id}  L${lvl}  ${recipe.name}`, x + 10, y + ch + 19);
        ctx.fillStyle = '#9a9186';
        ctx.font = '12px ui-monospace, Consolas, monospace';
        ctx.fillText(recipe.note, x + 10, y + ch + 36, cw - 20);
        if (!url) return;
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, x, y, cw, ch); };
        img.src = url;
      });
    });
  }, [sheetReady, shots, recipes, frames]);

  const levelLabel = (lvl: 0 | 1) => (lvl === 0 ? t.mastermind.board_level_l0 : t.mastermind.board_level_l1);

  return (
    <div className="mm-board" data-testid="mm-board">
      <header className="mm-board-head">
        <div className="mm-board-title">
          <span className="mm-board-mono">{board.id}</span>
          <span className="mm-board-axes">{frames.map(levelLabel).join(' · ')}</span>
        </div>
        <div className="mm-board-status" role="status" aria-live="polite">
          {rendering
            ? tx(t.mastermind.board_rendering, { done, total: cells.length })
            : picks.length > 0
              ? `${t.mastermind.board_picks}: ${picks.join(', ')}`
              : t.mastermind.board_keys_hint}
        </div>
        <button type="button" className="mm-board-btn" onClick={renderSheet} disabled={Boolean(rendering)} data-testid="mm-board-render">
          {t.mastermind.board_render_sheet}
        </button>
      </header>

      {/* The stage: one recipe, live, until a sheet is being rendered. */}
      <section className="mm-board-stage" style={{ width: STAGE_W, height: STAGE_H }} data-testid="mm-board-stage">
        {stage && (
          <Canvas
            // Keyed on the frame, not the recipe: switching recipes keeps the
            // operator's camera; a snapshot remounts so it lands on the pose.
            key={rendering ? `shot:${shotKey(rendering)}` : `live:${level}`}
            dpr={1}
            camera={{ fov: 42, near: 0.1, far: 400, position: [0, 12, 24] }}
            gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
          >
            <Suspense fallback={null}>
              <StrataScene world={MOCK_WORLD} nav={staticNav(stage.focus)} recipe={stage.recipe} interactive={!rendering} />
              {rendering && <Snapshot frames={SETTLE_FRAMES} onShot={onShot} />}
            </Suspense>
          </Canvas>
        )}
        {stage && (
          <div className="mm-board-stage-label mm-board-mono" data-testid="mm-board-stage-label">
            {rendering ? '…' : tx(t.mastermind.board_counter, { n: index + 1, total: recipes.length })}
            {' · '}{stage.recipe.id} · {stage.recipe.name} · {levelLabel(stage.level)}
          </div>
        )}
        {!rendering && (
          <>
            <button type="button" className="mm-board-arrow mm-board-arrow--prev" onClick={() => step(-1)} aria-label={t.mastermind.board_prev} data-testid="mm-board-prev">‹</button>
            <button type="button" className="mm-board-arrow mm-board-arrow--next" onClick={() => step(1)} aria-label={t.mastermind.board_next} data-testid="mm-board-next">›</button>
            {stage && <p className="mm-board-note">{stage.recipe.note}</p>}
          </>
        )}
      </section>

      {/* Recipe strip: one chip per recipe, the current one lit. Click to jump. */}
      <nav className="mm-board-strip" aria-label={t.mastermind.board_recipes}>
        {recipes.map((r, i) => (
          <button
            key={r.id}
            type="button"
            className={`mm-board-chip${i === index ? ' mm-board-chip--on' : ''}${picks.includes(r.id) ? ' mm-board-chip--picked' : ''}`}
            onClick={() => setIndex(i)}
            aria-current={i === index ? 'true' : undefined}
            data-testid={`mm-board-chip-${r.id}`}
          >
            <span className="mm-board-mono">{i + 1}</span> {r.name}
          </button>
        ))}
      </nav>

      {/* The cells, once a sheet has been rendered. */}
      {sheetReady && (
        <section className="mm-board-grid" style={{ gridTemplateColumns: `repeat(${recipes.length}, minmax(180px, 1fr))` }}>
          {recipes.map((recipe) => (
            <div key={recipe.id} className={`mm-board-col${picks.includes(recipe.id) ? ' mm-board-col--picked' : ''}`}>
              <div className="mm-board-col-head">
                <button type="button" className="mm-board-pick" aria-pressed={picks.includes(recipe.id)} onClick={() => togglePick(recipe.id)} data-testid={`mm-board-pick-${recipe.id}`}>
                  {picks.includes(recipe.id) ? '★' : '☆'}
                </button>
                <span className="mm-board-mono mm-board-id">{recipe.id}</span>
                <span className="mm-board-mono mm-board-name">{recipe.name}</span>
              </div>
              {frames.map((lvl) => {
                const cell: Cell = { recipe, level: lvl, focus: frameFocus(lvl) };
                const url = shots[shotKey(cell)];
                const isLive = stage && !rendering && shotKey(stage) === shotKey(cell);
                return (
                  <button
                    key={lvl}
                    type="button"
                    className={`mm-board-cell${isLive ? ' mm-board-cell--live' : ''}`}
                    onClick={() => openCell(cell)}
                    disabled={!url}
                    data-testid={`mm-board-cell-${recipe.id}-${lvl}`}
                  >
                    {url ? <img src={url} alt="" /> : <span className="mm-board-cell-ghost" />}
                    <span className="mm-board-cell-tag mm-board-mono">L{lvl}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      )}

      {/* The sheet — captured by the script, or right-click to save. */}
      <section className="mm-board-sheet" hidden={!sheetReady}>
        <p className="mm-board-hint">{t.mastermind.board_sheet_hint}</p>
        <canvas ref={sheetRef} data-testid="mm-board-sheet" />
      </section>
    </div>
  );
}
