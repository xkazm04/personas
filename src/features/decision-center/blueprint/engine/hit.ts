// Hit tests on the plan, in screen px.
import type { RoomNode, TileNode } from '../model/layout';
import type { Engine } from './Engine';

export function tileAt(e: Engine, px: number, py: number): TileNode | null {
  const lod = e.cam.lod(), slack = lod > 0.5 ? 0 : 6;
  for (const T of e.plan.L.tiles) {
    const r = e.featRect(T.id, lod);
    if (r && px >= r.x && px <= r.x + r.w && py >= r.y - slack && py <= r.y + r.h + slack) return T;
  }
  return null;
}

export function roomAt(e: Engine, px: number, py: number): RoomNode | null {
  const wx = e.cam.wx(px), wy = e.cam.wy(py);
  return e.plan.L.rooms.find((R) => wx >= R.x && wx <= R.x + R.w && wy >= R.y && wy <= R.y + R.h) ?? null;
}
