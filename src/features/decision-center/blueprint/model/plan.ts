// The product the drawing reads: bp's loadStructure over the map and the events log, then bp's plan layout.
// Structural (map + events), so it is computed once per product and the camera never re-fits on a refresh.
import { loadStructure, type Structure } from '../standard/load';
import { layoutProduct, type Layout } from './layout';

export interface Plan {
  S: Structure;
  L: Layout;
  /** The enabled lenses, in the map's file order (the sheet tabs, the glyph strip). */
  lenses: Structure['lenses'];
  LENS: Structure['LENS'];
}

export function buildPlan(structure: unknown, events: string): Plan {
  const S = loadStructure(structure, events || null);
  return { S, L: layoutProduct(S), lenses: S.lenses, LENS: S.LENS };
}
