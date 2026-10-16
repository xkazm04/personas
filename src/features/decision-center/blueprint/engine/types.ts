// What the canvas engine shares between its modules: the words it may draw, the hooks the page gives it, and the
// small records the draw passes keep between frames. The engine never calls IPC and never owns a string: every word
// on the canvas comes in as `EngineWords`, resolved from the page's translations.
import type { Health, Stage } from '../standard/types';
import type { TileNode, RoomNode } from '../model/layout';
import type { Safe } from './camera';

export interface EngineWords {
  /** A stage's plain word ("Built", "Construction"); sentence case, the canvas upper-cases where it prints caps. */
  stage(s: Stage): string;
  notDrawn: string;
  /** A lens verdict word, sentence case. */
  verdict(h: Health): string;
  /** "Features: n" (the panels' form). */
  features(n: number): string;
  /** "n features" (bp's stats-line form, on the canvas). */
  featuresN(n: number): string;
  live(n: number): string;
  building(n: number): string;
  partlyOpen(n: number): string;
  onPaper(n: number): string;
  demolish(n: number): string;
  good(n: number): string;
  watch(n: number): string;
  /** "n to watch" (a lens's place aggregate). */
  toWatch(n: number): string;
  bad(n: number): string;
  unmeasured(n: number): string;
  inTrouble(n: number): string;
  waiting(n: number): string;
  oldestWork: string;
  newestWork: string;
  chronology: string;
  canvasLabel: string;
  /** A number in the app's language. */
  num(n: number): string;
  /** A percentage (0-100) in the app's language. */
  pct(n: number): string;
  /** A boolean evidence field that is false: "No <label>". */
  fieldNo(label: string): string;
}

/** The current item: the fixture the eye was sent to, and the proposal that sent it. */
export interface Focus { fid: string; pid: string | null }

/** A trouble flag after layout and clustering: the box, where its tip lands, and the features it stands for. */
export interface FlagBox {
  x: number; y: number; w: number; h: number; tipX: number; tipY: number; bad: boolean; lens: string; fid: string; fids: string[]; lenses: string[];
}

export interface Hooks {
  /** The part of the canvas the chrome leaves free (px from each edge). */
  safe(): Safe;
  /** The camera moved or a frame drew. */
  moved(): void;
  /** `room`: the room under the pointer when no flag or fixture is (bp's place card). */
  hover(flag: FlagBox | null, tile: TileNode | null, px: number, py: number, room: RoomNode | null): void;
  flag(flag: FlagBox): void;
  /** `shift`: Shift was held (bp: Shift-click picks the fixture for a batch decision). */
  click(tile: TileNode | null, room: RoomNode | null, shift: boolean): void;
  descend(tile: TileNode | null, px: number, py: number): void;
}
