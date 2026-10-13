#!/usr/bin/env node
// `/mesh-onboard`'s CLI: pair two Personas apps and run the mutual tests through their /mesh doors.
//
//   node scripts/mesh/onboard.mjs preflight
//   node scripts/mesh/onboard.mjs discover [--timeout 600] [--peer <id>]
//   node scripts/mesh/onboard.mjs pair --peer <id> [--confirm <code> | --wait] [--timeout 600]
//   node scripts/mesh/onboard.mjs test --peer <id> [--allow-push] [--only t1_ping,t3_toggle] [--fresh]
//   node scripts/mesh/onboard.mjs report --peer <id>
//   node scripts/mesh/onboard.mjs status [--peer <id>]
//
// Every subcommand prints exactly ONE JSON line to stdout; progress lines go to stderr.
// Exit codes: 0 ok; 1 failed or blocked (the JSON carries `fix`); 2 usage; 3 retype the code;
// 4 timed out; 5 several peers, pick one with --peer.
//
// It never writes the app database, never echoes the local token, and runs no git command except
// t5's `git push origin --delete remote/<peer8>/<job8>` + `git ls-remote`, and only with --allow-push.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HandshakeError, MeshClient, MeshError, UnreachableError, normalizeCode, roleFor, short8 } from './client.mjs';
import { listStates, loadPreflight, loadState, markStep, meshDir, newState, nextStep, saveState, savePreflight } from './state.mjs';
import { TEST_IDS, defaultGit, runSuite, scaledTiming } from './tests.mjs';
import { writeReport } from './report.mjs';

export const EXIT = { ok: 0, failed: 1, usage: 2, retype: 3, timeout: 4, ambiguous: 5 };

/** Diagnostics that block onboarding when red. `mdns_sees_peers` only warns: the first machine up sees nobody yet. */
const BLOCKING_CHECKS = new Set(['p2p_built', 'network_running', 'udp_bound', 'firewall_rule', 'network_profile']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (['allow-push', 'wait', 'fresh'].includes(key)) { out[key] = true; continue; }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

/** The exact next action for a typed door error; never includes the token. */
export function fixFor(err) {
  const code = err && err.code;
  if (err instanceof HandshakeError || err instanceof UnreachableError || code === 'app_not_running' || code === 'unreachable') {
    return 'Start the Personas app on this machine and wait for its window, then run /mesh-onboard again.';
  }
  if (code === 'unauthorized') return 'The app refused the handshake token. Quit and restart the Personas app so it rewrites its handshake, then run /mesh-onboard again.';
  if (code === 'not_found' && err.unrouted) return 'This app build has no /mesh door. Update this checkout to a commit that contains the device mesh, restart the app, then run /mesh-onboard again.';
  if (code === 'p2p_unavailable') return 'The app\'s P2P network is not running. Restart the Personas app; if it stays down, rebuild it from a commit whose build carries p2p.';
  if (code === 'peer_not_paired') return 'The two apps are not paired yet. Run /mesh-onboard on both machines; it pairs before it tests.';
  if (code === 'request_timeout') return 'The app accepted the request but did not answer in time. Check the app is responsive, then run /mesh-onboard again; it resumes where it stopped.';
  return null;
}

async function waitFor(fn, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}

async function isPaired(client, peerId) {
  const d = await client.devices();
  if ((d.devices || []).some((v) => v.peerId === peerId && !v.isSelf)) return true;
  return (d.discovered || []).some((p) => p.peerId === peerId && p.paired);
}

function detectRepo(cwd) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', windowsHide: true });
  return {
    root: top.status === 0 ? top.stdout.trim() : null,
    originUrl: origin.status === 0 ? origin.stdout.trim() : null,
  };
}

/**
 * Run one subcommand. Returns the exit code; the JSON line goes to io.stdout.
 * @param {string[]} argv
 * @param {{env?:object, stdout?:{write:Function}, stderr?:{write:Function}, cwd?:string, git?:Function, repo?:object, client?:MeshClient}} io
 */
export async function main(argv, io = {}) {
  const env = io.env || process.env;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const say = (msg) => stderr.write(`[mesh-onboard] ${msg}\n`);
  const emit = (obj) => stdout.write(`${JSON.stringify(obj)}\n`);
  const args = parseArgs(argv);
  const sub = args._[0];
  const scale = Number(env.MESH_ONBOARD_TIME_SCALE) || 1;
  const timing = scaledTiming(scale);
  const dir = meshDir(env);
  const secs = (flag, dflt) => Math.round((Number(flag) || dflt) * 1000 * scale);

  if (!sub || !['preflight', 'discover', 'pair', 'test', 'report', 'status'].includes(sub)) {
    emit({ ok: false, error: 'usage', detail: 'subcommand: preflight | discover | pair | test | report | status' });
    return EXIT.usage;
  }
  const needPeer = ['pair', 'test', 'report'].includes(sub);
  if (needPeer && !args.peer) {
    emit({ ok: false, error: 'usage', detail: `${sub} needs --peer <peerId> (discover prints it)` });
    return EXIT.usage;
  }

  // status and report read only the persisted state: they work with the app down.
  if (sub === 'status') {
    if (args.peer) {
      const st = loadState(args.peer, dir);
      emit(st ? { ok: true, nextStep: nextStep(st), state: st } : { ok: true, nextStep: 'discovered', state: null });
    } else {
      const all = listStates(dir).map((s) => ({ peerId: s.peerId, displayName: s.displayName, role: s.role, nextStep: nextStep(s), updatedAtMs: s.updatedAtMs }));
      emit({ ok: true, states: all, resume: all.find((s) => s.nextStep) || null });
    }
    return EXIT.ok;
  }
  if (sub === 'report') {
    const st = loadState(args.peer, dir);
    if (!st) { emit({ ok: false, error: 'no_state', detail: `no onboarding state for peer ${short8(args.peer)}` }); return EXIT.failed; }
    const file = writeReport(st, dir);
    markStep(st, 'reported');
    saveState(st, dir);
    say(`report written: ${file}`);
    emit({ ok: true, path: file });
    return EXIT.ok;
  }

  let client;
  try {
    client = io.client || MeshClient.fromHandshake(env);
    const status = await client.status();
    const selfId = status.peerId;

    if (sub === 'preflight') {
      const { checks = [] } = await client.diagnostics();
      const all = [...checks];
      if (!status.p2p && !all.some((c) => c.id === 'p2p_built')) all.push({ id: 'p2p_built', ok: false, detail: 'this build has no p2p', fix: 'Rebuild the app from a commit whose build carries p2p.' });
      if (!status.networkRunning && !all.some((c) => c.id === 'network_running')) all.push({ id: 'network_running', ok: false, detail: 'the P2P network is not running', fix: null });
      const unreadable = (c) => c.id === 'firewall_rule' && /could not read/i.test(c.detail || '');
      const failing = all.filter((c) => !c.ok && BLOCKING_CHECKS.has(c.id) && !unreadable(c)).map(({ id, detail, fix }) => ({ id, detail, fix }));
      const warnings = all.filter((c) => !c.ok && !failing.some((f) => f.id === c.id)).map(({ id, detail, fix }) => ({ id, detail, fix }));
      const result = { ok: failing.length === 0, appVersion: status.appVersion, peerId: selfId, displayName: status.displayName, quicPort: status.quicPort, dataDirIsolated: status.dataDirIsolated, failing, warnings };
      savePreflight(result, dir);
      for (const f of failing) say(`RED ${f.id}: ${f.detail}${f.fix ? ` -> fix: ${f.fix}` : ''}`);
      for (const w of warnings) say(`warn ${w.id}: ${w.detail}`);
      emit(result);
      return result.ok ? EXIT.ok : EXIT.failed;
    }

    if (!selfId) {
      emit({ ok: false, error: 'no_peer_id', detail: 'the app reports no peer id: its P2P identity is not up', fix: fixFor({ code: 'p2p_unavailable' }) });
      return EXIT.failed;
    }

    if (sub === 'discover') {
      const timeoutMs = secs(args.timeout, 600);
      say(`looking for the other machine on the LAN (up to ${Math.round(timeoutMs / 1000)} s)`);
      let lastConnect = 0;
      const found = await waitFor(async () => {
        const d = await client.devices();
        const seen = (d.discovered || []).filter((p) => p.peerId !== selfId);
        // A paired device that is not in the discovery list still counts when it is connected.
        for (const v of d.devices || []) {
          if (!v.isSelf && !seen.some((p) => p.peerId === v.peerId)) {
            seen.push({ peerId: v.peerId, displayName: v.displayName, paired: true, connected: v.reachability === 'connected' });
          }
        }
        const pool = args.peer ? seen.filter((p) => p.peerId === args.peer) : seen;
        const pairedOffline = pool.filter((p) => p.paired && !p.connected);
        if (pairedOffline.length && Date.now() - lastConnect > 15_000 * scale) {
          lastConnect = Date.now();
          for (const p of pairedOffline) await client.connect(p.peerId).catch(() => null);
        }
        const candidates = pool.filter((p) => !p.paired || p.connected);
        return candidates.length ? candidates : null;
      }, timeoutMs, timing.pollMs);
      if (!found) {
        let failing = [];
        try { failing = ((await client.diagnostics()).checks || []).filter((c) => !c.ok).map(({ id, detail, fix }) => ({ id, detail, fix })); } catch { /* the timeout is the finding */ }
        emit({ ok: false, step: 'discover', error: 'timeout', detail: `no peer appeared within ${Math.round(timeoutMs / 1000)} s`, failing, fix: failing.find((f) => f.fix)?.fix || 'Make sure the Personas app is running on the other machine, both machines are on the same LAN, and the network profile is Private on both.' });
        return EXIT.timeout;
      }
      if (found.length > 1) {
        emit({ ok: false, step: 'discover', error: 'ambiguous', candidates: found.map((p) => ({ peerId: p.peerId, displayName: p.displayName, paired: !!p.paired })), detail: 'more than one device is visible; re-run with --peer <peerId>' });
        return EXIT.ambiguous;
      }
      const peer = found[0];
      const role = roleFor(selfId, peer.peerId);
      let connected = !!peer.connected;
      if (!peer.paired && role === 'initiator' && !connected) {
        const c = await client.connect(peer.peerId).catch((e) => ({ connected: false, detail: e.message }));
        connected = !!c.connected;
        if (!connected) say(`connect: ${c.detail || 'not connected yet'} (pair will retry)`);
      }
      const st = loadState(peer.peerId, dir) || newState({ peerId: peer.peerId });
      Object.assign(st, { selfPeerId: selfId, displayName: peer.displayName || st.displayName, role });
      st.preflight = loadPreflight(dir) || st.preflight;
      markStep(st, 'discovered');
      if (peer.paired && !st.steps.paired) markStep(st, 'paired');
      saveState(st, dir);
      say(`found ${peer.displayName || short8(peer.peerId)}; this machine is the ${role}`);
      emit({ ok: true, peerId: peer.peerId, displayName: peer.displayName || null, paired: !!peer.paired, connected, role });
      return EXIT.ok;
    }

    const peerId = args.peer;
    const st = loadState(peerId, dir) || newState({ peerId, selfPeerId: selfId });
    st.selfPeerId = selfId;
    st.role = roleFor(selfId, peerId);

    if (sub === 'pair') {
      const timeoutMs = secs(args.timeout, 600);
      if (await isPaired(client, peerId)) {
        markStep(st, 'paired');
        saveState(st, dir);
        emit({ ok: true, paired: true, role: st.role });
        return EXIT.ok;
      }
      if (args.confirm !== undefined) {
        if (st.role !== 'responder') {
          emit({ ok: false, error: 'usage', detail: 'only the responder types the code; the initiator shows it and runs pair --wait' });
          return EXIT.usage;
        }
        const code = normalizeCode(args.confirm);
        const pendingExpiry = async () => {
          const { pending = [] } = await client.pairPending().catch(() => ({ pending: [] }));
          const e = pending.find((p) => p.peerId === peerId);
          return e ? e.expiresAtMs : null;
        };
        if (!code) {
          emit({ ok: false, paired: false, error: 'bad_code_format', retype: true, detail: 'the code is six digits, shown as NNN-NNN on the other machine', expiresAtMs: await pendingExpiry() });
          return EXIT.retype;
        }
        try {
          await client.pairConfirm(peerId, code);
        } catch (e) {
          if (e instanceof MeshError && e.code === 'code_mismatch') {
            const expiresAtMs = await pendingExpiry();
            emit({ ok: false, paired: false, error: 'code_mismatch', retype: true, expiresAtMs, secondsLeft: expiresAtMs ? Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)) : null, detail: 'that code does not match the one the other machine shows' });
            return EXIT.retype;
          }
          if (e instanceof MeshError && e.code === 'no_pending_pairing') {
            emit({ ok: false, paired: false, error: 'no_pending_pairing', detail: 'the pairing request expired or was withdrawn', fix: 'Run /mesh-onboard on both machines again; the initiator will show a new code.' });
            return EXIT.failed;
          }
          throw e;
        }
        markStep(st, 'paired');
        st.pair = { ...(st.pair || {}), confirmedAtMs: Date.now() };
        saveState(st, dir);
        say('paired');
        emit({ ok: true, paired: true, role: st.role });
        return EXIT.ok;
      }
      if (st.role === 'initiator' && args.wait) {
        const budget = st.pair && st.pair.expiresAtMs ? Math.min(timeoutMs, Math.max(0, st.pair.expiresAtMs - Date.now()) + 30_000 * scale) : timeoutMs;
        say('waiting for the other machine to confirm the code');
        const ok = await waitFor(() => isPaired(client, peerId), budget, timing.pollMs);
        if (!ok) {
          emit({ ok: false, paired: false, step: 'pair', error: 'timeout', detail: 'the other machine did not confirm the code in time', fix: 'Run pair again on this machine for a new code, and type it on the other machine.' });
          return EXIT.timeout;
        }
        markStep(st, 'paired');
        saveState(st, dir);
        emit({ ok: true, paired: true, role: st.role });
        return EXIT.ok;
      }
      if (st.role === 'initiator') {
        const { pending = [] } = await client.pairPending();
        const mine = pending.find((p) => p.peerId === peerId && p.role === 'initiator');
        if (mine && st.pair && st.pair.code && st.pair.expiresAtMs > Date.now()) {
          say('resuming the pairing already in flight');
          emit({ ok: true, role: 'initiator', code: st.pair.code, expiresAtMs: st.pair.expiresAtMs, resumed: true });
          return EXIT.ok;
        }
        const isConnected = async () => {
          const d = await client.devices();
          return (d.discovered || []).some((p) => p.peerId === peerId && p.connected);
        };
        if (!(await isConnected())) {
          await client.connect(peerId).catch(() => null);
          const up = await waitFor(isConnected, 60_000 * scale, timing.pollMs);
          if (!up) {
            emit({ ok: false, step: 'pair', error: 'not_connected', detail: 'the other machine is visible but the QUIC connection did not come up', fix: 'Allow inbound UDP for the Personas app on BOTH machines (run preflight on each and apply its firewall fix), then run /mesh-onboard again.' });
            return EXIT.failed;
          }
        }
        const { code } = await client.pairRequest(peerId);
        const after = await client.pairPending().catch(() => ({ pending: [] }));
        const entry = (after.pending || []).find((p) => p.peerId === peerId);
        st.pair = { code, requestedAtMs: Date.now(), expiresAtMs: entry ? entry.expiresAtMs : null };
        saveState(st, dir);
        emit({ ok: true, role: 'initiator', code, expiresAtMs: st.pair.expiresAtMs });
        return EXIT.ok;
      }
      // responder: wait for the initiator's request to land here
      say('waiting for the other machine to start pairing');
      const entry = await waitFor(async () => {
        if (await isPaired(client, peerId)) return { paired: true };
        const { pending = [] } = await client.pairPending();
        return pending.find((p) => p.peerId === peerId && p.role === 'responder') || null;
      }, timeoutMs, timing.pollMs);
      if (!entry) {
        emit({ ok: false, step: 'pair', error: 'timeout', detail: 'the other machine never started pairing', fix: 'Run /mesh-onboard on the other machine; it shows the code once it reaches the pair step.' });
        return EXIT.timeout;
      }
      if (entry.paired) {
        markStep(st, 'paired');
        saveState(st, dir);
        emit({ ok: true, paired: true, role: st.role });
        return EXIT.ok;
      }
      emit({ ok: true, role: 'responder', awaitingCode: true, expiresAtMs: entry.expiresAtMs });
      return EXIT.ok;
    }

    if (sub === 'test') {
      if (!(await isPaired(client, peerId))) {
        emit({ ok: false, error: 'peer_not_paired', detail: 'the apps are not paired', fix: fixFor({ code: 'peer_not_paired' }) });
        return EXIT.failed;
      }
      if (!st.steps.paired) markStep(st, 'paired');
      const only = args.only ? String(args.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
      const unknown = (only || []).filter((t) => !TEST_IDS.includes(t));
      if (unknown.length) {
        emit({ ok: false, error: 'usage', detail: `unknown test ids: ${unknown.join(', ')}; known: ${TEST_IDS.join(', ')}` });
        return EXIT.usage;
      }
      const summary = await runSuite({
        client, state: st, save: () => saveState(st, dir), selfPeerId: selfId, peerId,
        options: { allowPush: !!args['allow-push'], only, fresh: !!args.fresh },
        timing, repo: io.repo || detectRepo(io.cwd || process.cwd()), git: io.git || defaultGit, log: say,
      });
      if (summary.done && !summary.aborted) markStep(st, 'tested');
      saveState(st, dir);
      emit({
        ok: summary.failed === 0,
        runId: summary.runId, passed: summary.passed, failed: summary.failed, skipped: summary.skipped,
        aborted: summary.aborted,
        tests: summary.tests.map((t) => ({
          id: t.id,
          result: t.combined ? t.combined.outcome : 'not run',
          thisSide: t.local ? { outcome: t.local.outcome, stalledAt: t.local.stalledAt, detail: t.local.detail } : null,
          peerSide: t.peer ? { outcome: t.peer.outcome, stalledAt: t.peer.stalledAt, detail: t.peer.detail } : null,
        })),
      });
      return summary.failed === 0 ? EXIT.ok : EXIT.failed;
    }
  } catch (e) {
    const fix = fixFor(e);
    emit({ ok: false, step: sub, error: (e && e.code) || 'internal', detail: e && e.message, fix });
    return EXIT.failed;
  }
  return EXIT.usage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
