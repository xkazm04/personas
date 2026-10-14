// The onboarding step state machine, persisted per peer so a killed session resumes at its step.
//
// File: <meshDir>/onboard-<peer8>.json, where meshDir is <PERSONAS_DATA_DIR>/mesh when that env is
// set (the same rule the app uses for its dev-only one-box handshake) and ~/.personas/mesh otherwise.
// Every write is atomic (temp file + rename), so a kill mid-write leaves the previous state intact.
//
// Steps run in order: discovered -> paired -> tested -> reported. A step is "done" when its key in
// `state.steps` holds a timestamp; `nextStep` names the first one that is not.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { short8 } from './client.mjs';

export const STEPS = ['discovered', 'paired', 'tested', 'reported'];
export const STATE_VERSION = 1;

export function meshDir(env = process.env) {
  if (env.PERSONAS_DATA_DIR) return path.join(env.PERSONAS_DATA_DIR, 'mesh');
  return path.join(os.homedir(), '.personas', 'mesh');
}

export function statePath(peerId, dir = meshDir()) {
  return path.join(dir, `onboard-${short8(peerId)}.json`);
}

export function newState({ peerId, selfPeerId = null, displayName = null, role = null }) {
  return {
    version: STATE_VERSION,
    peerId,
    peer8: short8(peerId),
    selfPeerId,
    displayName,
    role,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    steps: {},
    preflight: null,
    pair: null,
    run: null,
    history: [],
  };
}

export function loadState(peerId, dir = meshDir()) {
  const file = statePath(peerId, dir);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { return JSON.parse(raw); } catch {
    throw new Error(`the onboarding state at ${file} is not JSON; move it aside to start over`);
  }
}

export function saveState(state, dir = meshDir()) {
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAtMs = Date.now();
  const file = statePath(state.peerId, dir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

export function markStep(state, step) {
  if (!STEPS.includes(step)) throw new Error(`unknown step ${step}`);
  state.steps[step] = Date.now();
  return state;
}

/** The first step not yet done, or null when the whole loop is finished. */
export function nextStep(state) {
  if (!state) return 'discovered';
  return STEPS.find((s) => !state.steps[s]) || null;
}

/** Every persisted onboarding state in the dir, most recently updated first. */
export function listStates(dir = meshDir()) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^onboard-[a-z0-9]{1,8}\.json$/.test(n)) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))); } catch { /* a torn file is skipped */ }
  }
  return out.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
}

/** The last preflight result, kept outside any peer's state (preflight runs before a peer is known). */
export function savePreflight(result, dir = meshDir()) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-preflight.json'), JSON.stringify({ ...result, atMs: Date.now() }, null, 2));
}

export function loadPreflight(dir = meshDir()) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'last-preflight.json'), 'utf8')); } catch { return null; }
}
