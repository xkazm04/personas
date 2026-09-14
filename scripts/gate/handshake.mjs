// ~/.personas/gate-daemon.json  { port, token, pid, baseRoot, fingerprint, startedAt }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function handshakeDir() {
  return path.join(os.homedir(), '.personas');
}

export function handshakePath() {
  return path.join(handshakeDir(), 'gate-daemon.json');
}

export function logPath() {
  return path.join(handshakeDir(), 'gate-daemon.log');
}

export function readHandshake() {
  try {
    const obj = JSON.parse(fs.readFileSync(handshakePath(), 'utf8'));
    if (!obj || typeof obj.port !== 'number' || typeof obj.token !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

export function writeHandshake(obj) {
  fs.mkdirSync(handshakeDir(), { recursive: true });
  const tmp = handshakePath() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, handshakePath());
  try {
    fs.chmodSync(handshakePath(), 0o600);
  } catch {
    // mode bits are advisory on Windows
  }
}

/** Remove the handshake only if it still belongs to `pid` (unconditionally when pid is undefined). */
export function removeHandshake(pid) {
  const cur = readHandshake();
  if (pid !== undefined && cur && cur.pid !== pid) return false;
  try {
    fs.unlinkSync(handshakePath());
    return true;
  } catch {
    return false;
  }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === 'EPERM');
  }
}
