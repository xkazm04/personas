#!/usr/bin/env node
// The ported Conversations tab's tape (spark mandate-lanes, WP12 Phase B): the
// variants tape plus the ONE fleet-wide pending-review read the Needs you rail
// and the projects plate share (`usePendingAsks`, limit 200).
//
//   node scripts/style/page-harness/conversationPortTape.mjs tmp/style-tapes/conv-port.json
//   node scripts/style/shoot.mjs --module monitor/conversations/port --tape tmp/style-tapes/conv-port.json \
//     --reduced-motion --settle 3000 --out <dir> --label port --sizes 1280x800,1920x1080 --themes dark-midnight,light
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELD, buildConversationVariantsTape } from './conversationVariantsTape.mjs';

const agenda = (id, item, status) => ({
  id, deliberationId: 'dl-1', item, status, resolution: null, openedBy: null, createdAt: '2026-10-16T08:00:00Z', resolvedAt: null,
});

export function buildConversationPortTape() {
  const base = buildConversationVariantsTape();
  // Drive reads the deliberation's detail, agenda, turns and tracks (useTeamDeliberations).
  const deliberation = base.calls.find((c) => c.cmd === 'list_team_deliberations')?.response?.[0] ?? null;
  return {
    ...base,
    note: `${base.note} Port (conversationPortTape.mjs): the fleet-wide pending-review read, the driven deliberation.`,
    calls: [
      ...base.calls,
      {
        cmd: 'list_manual_reviews_page',
        args: { personaId: null, status: 'pending', cursor: null, limit: 200 },
        response: { rows: HELD, hasMore: false, nextCursor: null },
      },
      { cmd: 'get_team_deliberation', response: deliberation },
      {
        cmd: 'list_deliberation_agenda',
        response: [
          agenda('ag-1', 'Measure cold start with one chunk', 'resolved'),
          agenda('ag-2', 'Decide where the editor loads', 'open'),
          agenda('ag-3', 'Agree the size budget for the settings route', 'open'),
        ],
      },
      { cmd: 'list_deliberation_turns', response: [] },
      { cmd: 'list_deliberation_tracks', response: [] },
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/conv-port.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildConversationPortTape(), null, 2));
  console.log(`wrote ${out}`);
}
