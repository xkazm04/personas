#!/usr/bin/env node
// The terminal standup's client for the app's one plan (spark app-standup).
//
// While the Personas app runs, `/athena --standup` reads and arms the APP's
// standup through its local HTTP doors (`src-tauri/src/local_http/standup.rs`)
// instead of keeping a plan in files. This helper finds the app through its
// handshake file and calls one door per invocation, printing the JSON answer.
//
//   node standup-client.mjs ping                       exit 0 = app answers, 3 = app closed
//   node standup-client.mjs current                    the live standup, or null
//   node standup-client.mjs open                       open (or reuse) the draft revision
//   node standup-client.mjs item <standupId> <patch>   <patch> = JSON or @file.json (StandupItemPatch)
//   node standup-client.mjs arm <standupId>            pass the go-gate (idempotent)
//   node standup-client.mjs end <standupId>            end it; the report becomes final
//
// Handshake order matches the app's: <PERSONAS_DATA_DIR>/local-http.json, then
// ~/.personas/local-http.json. The token never leaves this process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT = { OK: 0, USAGE: 2, NO_APP: 3, REFUSED: 4 };

function handshake() {
  const candidates = [];
  const dir = (process.env.PERSONAS_DATA_DIR || '').trim();
  if (dir) candidates.push(path.join(dir, 'local-http.json'));
  candidates.push(path.join(os.homedir(), '.personas', 'local-http.json'));
  for (const file of candidates) {
    try {
      const h = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (h && h.port && h.token) return h;
    } catch {
      // Missing or half-written handshake: try the next one; none = app closed.
    }
  }
  return null;
}

async function call(h, method, route, body) {
  const res = await fetch(`http://127.0.0.1:${h.port}/companion/standup/${route}`, {
    method,
    headers: {
      'x-personas-local-token': h.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(route === 'arm' ? 90_000 : 20_000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function readPatch(arg) {
  if (!arg) throw new Error('item needs a patch (JSON or @file.json)');
  const raw = arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg;
  return JSON.parse(raw);
}

async function main() {
  const [verb, a, b] = process.argv.slice(2);
  let req;
  switch (verb) {
    case 'ping':
    case 'current':
      req = ['GET', 'current'];
      break;
    case 'open':
      req = ['POST', 'open', {}];
      break;
    case 'item':
      if (!a) return usage();
      req = ['PATCH', 'item', { standupId: a, patch: readPatch(b) }];
      break;
    case 'arm':
    case 'end':
      if (!a) return usage();
      req = ['POST', verb, { standupId: a }];
      break;
    default:
      return usage();
  }
  const h = handshake();
  if (!h) {
    console.error('the Personas app is not running (no local-http.json handshake): use file mode');
    return EXIT.NO_APP;
  }
  let res;
  try {
    res = await call(h, ...req);
  } catch (e) {
    console.error(`the app did not answer on port ${h.port} (${e.message}): use file mode`);
    return EXIT.NO_APP;
  }
  if (verb === 'ping') {
    if (res.status === 200) {
      console.log('ok');
      return EXIT.OK;
    }
    console.error(`the app answered ${res.status}: ${res.text}`);
    return EXIT.NO_APP;
  }
  if (res.status !== 200) {
    console.error(`refused (${res.status}): ${res.text}`);
    return EXIT.REFUSED;
  }
  console.log(res.text);
  return EXIT.OK;
}

function usage() {
  console.error('usage: standup-client.mjs ping|current|open|item <id> <patch>|arm <id>|end <id>');
  return EXIT.USAGE;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e.message);
    process.exit(EXIT.USAGE);
  },
);
