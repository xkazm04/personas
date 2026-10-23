// The door client's pure helpers and its handshake resolution order (the frozen contract's rule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeshClient, isTerminal, jobReceipt, normalizeCode, readHandshake, resolveHandshakePath, roleFor, short8 } from '../client.mjs';
import { findSharedProject, normalizeGitUrl } from '../tests.mjs';
import { StubDoor } from '../stub-door.mjs';
import { meshDir } from '../state.mjs';

test('handshake resolution: PERSONAS_HANDSHAKE, then PERSONAS_DATA_DIR, then ~/.personas', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-hs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  assert.equal(resolveHandshakePath({ PERSONAS_HANDSHAKE: path.join(dir, 'x.json'), PERSONAS_DATA_DIR: dir }), path.join(dir, 'x.json'));
  assert.equal(resolveHandshakePath({ PERSONAS_DATA_DIR: dir }), path.join(dir, 'local-http.json'));
  assert.equal(resolveHandshakePath({}), path.join(os.homedir(), '.personas', 'local-http.json'));
  assert.equal(resolveHandshakePath({ PERSONAS_HANDSHAKE: '', PERSONAS_DATA_DIR: dir }), path.join(dir, 'local-http.json'), 'an empty env var counts as unset');
  assert.equal(meshDir({ PERSONAS_DATA_DIR: dir }), path.join(dir, 'mesh'), 'the state dir follows the same data-dir rule');
  fs.writeFileSync(path.join(dir, 'local-http.json'), JSON.stringify({ port: 1234, token: 'tok', pid: 1 }));
  const h = readHandshake({ PERSONAS_DATA_DIR: dir });
  assert.deepEqual([h.port, h.token], [1234, 'tok']);
  assert.throws(() => readHandshake({ PERSONAS_HANDSHAKE: path.join(dir, 'missing.json') }), (e) => e.code === 'app_not_running');
});

test('the client never exposes its token through serialization', () => {
  const c = new MeshClient({ port: 1, token: 'sekrit' });
  assert.ok(!JSON.stringify(c).includes('sekrit'));
  assert.equal(c.token, 'sekrit');
});

test('helpers: short8 matches the app rule, roles, codes, terminal states, receipts', () => {
  assert.equal(short8('12D3-KooW_xyzABC'), '12d3koow');
  assert.equal(roleFor('AAA', 'BBB'), 'initiator');
  assert.equal(roleFor('BBB', 'AAA'), 'responder');
  assert.equal(normalizeCode('042917'), '042-917');
  assert.equal(normalizeCode(' 042 917 '), '042-917');
  assert.equal(normalizeCode('042-91'), null);
  for (const s of ['queued', 'pending', 'running']) assert.equal(isTerminal(s), false);
  for (const s of ['completed', 'failed', 'refused', 'cancelled']) assert.equal(isTerminal(s), true);
  assert.deepEqual(jobReceipt({ meshReceipt: { verb: 'ping', ok: true, detail: '1.2.3 p2p' }, receipt: null }), { verb: 'ping', ok: true, detail: '1.2.3 p2p' }, 'amendment A1: meshReceipt first');
  assert.deepEqual(jobReceipt({ receiptJson: '{"verb":"ping","ok":true,"detail":"1.2.3 p2p"}' }), { verb: 'ping', ok: true, detail: '1.2.3 p2p' });
  assert.deepEqual(jobReceipt({ receiptJson: null, receipt: { branch: 'remote/a/b' } }), { branch: 'remote/a/b' });
  assert.equal(jobReceipt({ receiptJson: null, receipt: null }), null);
});

test('git URL normalization makes https and ssh origins compare equal', () => {
  const want = 'github.com/xkazm04/personas';
  for (const u of ['https://github.com/xkazm04/personas', 'https://github.com/xkazm04/personas.git', 'git@github.com:xkazm04/personas.git', 'ssh://git@github.com/xkazm04/personas', 'https://user@github.com/XKAZM04/Personas/']) {
    assert.equal(normalizeGitUrl(u), want, u);
  }
});

test('findSharedProject: githubUrl first, then root path; falls back to the dev-tools door when /mesh/projects is unrouted', async (t) => {
  const door = await new StubDoor({ projects: [
    { id: 'p1', name: 'other', githubUrl: 'https://github.com/x/other', rootPath: 'C:\\work\\other' },
    { id: 'p2', name: 'personas', githubUrl: 'https://github.com/xkazm04/personas', rootPath: 'C:\\work\\personas' },
  ] }).start();
  t.after(() => door.stop());
  const client = new MeshClient({ port: door.port, token: door.token });
  assert.equal((await findSharedProject(client, { originUrl: 'git@github.com:xkazm04/personas.git' })).id, 'p2');
  assert.equal((await findSharedProject(client, { originUrl: null, root: 'C:/work/personas' })).id, 'p2');
  assert.equal((await findSharedProject(client, { originUrl: 'https://github.com/nobody/none' })).none, true);

  // a door without /mesh/projects: the dev-tools door answers snake_case DevProject rows
  const route = door.route.bind(door);
  door.route = (method, url, body, headers) => {
    if (url.pathname === '/mesh/projects') return null;
    if (url.pathname === '/dev-tools/projects') return { body: [{ id: 'd1', name: 'personas', root_path: '/w/personas', github_url: 'https://github.com/xkazm04/personas' }] };
    return route(method, url, body, headers);
  };
  assert.equal((await findSharedProject(client, { originUrl: 'https://github.com/xkazm04/personas' })).id, 'd1');
});
