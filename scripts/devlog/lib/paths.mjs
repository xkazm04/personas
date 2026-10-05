// Where devlog reads and writes, and the clock it stamps records with.
//
// The logs dir is the app's: `$PERSONAS_DATA_DIR/logs` when the multi-instance
// override is set (src-tauri/src/boot/paths.rs), else the OS app-data dir. Dev
// and release builds share it, which is why every digest filters by profile.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const APP_ID = "com.personas.desktop";

/** The app's logs dir. `override` (a `--logs` flag) wins, then the env. */
export function resolveLogsDir(override, env = process.env, platform = process.platform) {
  if (override) return path.resolve(override);
  if (env.DEVLOG_LOGS_DIR) return path.resolve(env.DEVLOG_LOGS_DIR);
  if (env.PERSONAS_DATA_DIR) return path.join(env.PERSONAS_DATA_DIR, "logs");
  const home = os.homedir();
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, APP_ID, "logs");
  }
  if (platform === "darwin") return path.join(home, "Library", "Application Support", APP_ID, "logs");
  const xdg = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, APP_ID, "logs");
}

/** Wall clock in integer microseconds since the epoch. */
export function nowMicros() {
  return Math.round((performance.timeOrigin + performance.now()) * 1000);
}

/** RFC3339 UTC with microseconds and a `Z`, the envelope's `ts`. */
export function isoMicros(micros = nowMicros()) {
  const ms = Math.floor(micros / 1000);
  const sub = String(micros % 1000).padStart(3, "0");
  return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, `.$1${sub}Z`);
}

/** `YYYY-MM-DD` of a UTC instant, the date in every daily file name. */
export function utcDate(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Forward slashes only; the one spelling of a path inside a record. */
export function slash(p) {
  return p == null ? p : String(p).replace(/\\/g, "/");
}
