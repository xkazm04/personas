// @vitest-environment node
/**
 * What a place says (engine/place-words.ts), held by bp's own cases where they carry over: bp scripts/check-place-words.ts
 * @ 93f30b0 part 1. bp pins five literal sentences on ITS Kettle sample (bp's named wings, 32+ features a wing); the
 * Personas fixture is trimmed to 30 features and draws one wing per domain (model/layout.ts EDIT), so the literal
 * strings cannot carry. What is held instead is each sentence's anatomy as bp composes it, under bp's English words
 * (`W` below): the place name, the stage parts summing to the place's features, the trouble clause naming the first
 * bad feature and its reason, a lens view speaking the lens's own parts, and bp's past-date rule (stage counts, no
 * trouble). Parts 2-3 (hover card, live region, Engine) are WP2/WP3's.
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { placeParts, placeSentence, placeWords, type PlaceSentenceWords, type PlaceWords } from '../engine/place-words';
import type { Health } from '../standard/types';

const plan = buildPlan(kettleData().structure, kettleData().events);
const { S, L } = plan;
const VERDICT: Record<Health, string> = { good: 'Good', watch: 'Watch', bad: 'In trouble', na: 'Does not apply', unmeasured: 'Not measured' };
/** bp's English (place-words.ts @ 93f30b0 and aggregates.ts stageParts). */
const W: PlaceSentenceWords = {
  featuresN: (n) => n + ' feature' + (n === 1 ? '' : 's'),
  live: (n) => n + ' live', building: (n) => n + ' building', onPaper: (n) => n + ' on paper',
  verdict: (h) => VERDICT[h], bad: (n) => n + ' bad', toWatch: (n) => n + ' to watch',
  placeName: (w: PlaceWords) => (w.type === 'room' ? 'Room ' + w.title + ' · wing ' + w.wing!.letter
    : w.type === 'bay' ? 'Bay ' + w.title + ' · room ' + w.room : w.type === 'wing' ? 'Wing ' + w.wing!.letter + ' ' + w.title : 'Building ' + w.title),
  inTroubleUnder: (n, lens) => n + ' in trouble' + (lens ? ' under ' + lens : ''),
};
const say = (type: PlaceWords['type'], id: string, view: string, t = S.asOf) => {
  const w = placeWords(L, plan, type, id, view, t, S.asOf, 7);
  return w ? placeSentence(w, W) : null;
};

describe('placeWords / placeSentence (bp check-place-words part 1)', () => {
  const troubledRoom = L.rooms.find((R) => R.feats.some((f) => f.health === 'bad'))!;
  const calmBay = L.bays.find((B) => B.feats.every((f) => f.health !== 'bad'))!;

  it("General, a room: its name and wing, the stage parts, how many are in trouble and the first one's reason", () => {
    const w = placeWords(L, plan, 'room', troubledRoom.id, 'general', S.asOf, S.asOf, 7)!;
    const bad = troubledRoom.feats.filter((f) => f.health === 'bad');
    const f0 = bad[0]!, t0 = f0.trouble.find((x) => x.h === 'bad')!;
    const c = w.counts;
    expect(c.live + c.flagged + c.build + c.paper + c.dep + c.none).toBe(troubledRoom.feats.length);
    expect(w.bad).toBe(bad.length);
    expect(w.first).toEqual({ fid: f0.id, name: f0.name, lens: t0.lens, lensName: plan.LENS[t0.lens]!.name, why: t0.why });
    expect(say('room', troubledRoom.id, 'general')).toBe(
      'Room ' + troubledRoom.d.name + ' · wing ' + troubledRoom.wing.def.letter + ' · ' + W.featuresN(c.n) + ' · ' + (c.live + c.flagged) + ' live · ' + c.build + ' building · ' + c.paper + ' on paper'
      + ' · ' + bad.length + ' in trouble: ' + f0.name + ', ' + plan.LENS[t0.lens]!.name + ': ' + t0.why);
  });
  it('General, a wing: the wing letter and name lead', () => {
    const wing = L.wings[0]!;
    expect(say('wing', wing.id, 'general')!.startsWith('Wing ' + wing.def.letter + ' ' + wing.def.name + ' · ' + W.featuresN(wing.feats.length) + ' · ')).toBe(true);
  });
  it('General, a bay with nothing in trouble has no trouble clause', () => {
    const s = say('bay', calmBay.id, 'general')!;
    expect(s.startsWith('Bay ' + calmBay.cap.name + ' · room ' + calmBay.room.d.name + ' · ')).toBe(true);
    expect(s).not.toContain('in trouble');
  });
  it("a lens view: the lens's own place parts, and the trouble under that lens", () => {
    const lens = plan.lenses.find((d) => troubledRoom.feats.some((f) => f.lens[d.id]?.h === 'bad'))!;
    const w = placeWords(L, plan, 'room', troubledRoom.id, lens.id, S.asOf, S.asOf, 7)!;
    expect(w.lensPart).not.toBeNull();
    const parts = placeParts(w, W);
    expect(parts[0]).toBe(W.featuresN(troubledRoom.feats.length));
    expect(parts).toContain(w.lensPart!.bad + ' bad');
    const s = placeSentence(w, W);
    expect(s).toContain(' in trouble under ' + lens.name + ': ' + w.first!.name + ', ' + w.first!.why);
    expect(w.first!.lens).toBe(lens.id);
  });
  it('on a past date a place says its stage counts and no trouble (health is not recorded for that date)', () => {
    const past = placeWords(L, plan, 'room', troubledRoom.id, plan.lenses[0]!.id, S.weeks[0]!, S.asOf, 7)!;
    expect(past.bad).toBe(0);
    expect(past.first).toBeNull();
    expect(past.lensPart).toBeNull();
    expect(placeParts(past, W)[1]!.endsWith('live')).toBe(true);
  });
  it('an unknown place is null; the building speaks its wings and rooms', () => {
    expect(placeWords(L, plan, 'room', 'no-such-room', 'general', S.asOf, S.asOf, 7)).toBeNull();
    const b = placeWords(L, plan, 'bld', L.bld.id, 'general', S.asOf, S.asOf, 7)!;
    expect(b.sub).toEqual({ kind: 'bld', wings: L.wings.length, rooms: L.rooms.length });
    expect(b.counts.n).toBe(L.bld.feats.length);
  });
});
