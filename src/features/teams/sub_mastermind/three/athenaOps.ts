// Athena's scripted operations for the prototypes — what "she can manipulate
// the world and operate within it" looks like before the real companion is
// wired to it. Each command is a timeline of reducer actions: she flies the
// camera (the reference build's "galaxy flies to the exact note"), points at
// nodes, narrates in the transcript, and in one case CHANGES the world
// (binds monitoring on Brainiac) so the demo shows operate, not just look.
//
// Copy is carried as i18n keys with params — the HUD resolves them.
import { DIM_REGISTRY, type DimKey } from '../lib/dimRegistry';

import { attentionDims, findProject, type World } from './mockWorld';
import { nodeId, type WorldAction } from './worldModel';

export type AthenaCommand = 'risks' | 'ship' | 'focus' | 'wire';

export const ATHENA_COMMANDS: AthenaCommand[] = ['risks', 'ship', 'focus', 'wire'];

/** i18n key of the chip / "you" transcript line per command. */
export const ATHENA_CHIP_KEY: Record<AthenaCommand, string> = {
  risks: 'athena_chip_risks',
  ship: 'athena_chip_ship',
  focus: 'athena_chip_focus',
  wire: 'athena_chip_wire',
};

export interface AthenaStep {
  /** Milliseconds after the command starts. */
  at: number;
  actions: WorldAction[];
}

const say = (key: string, params?: Record<string, string | number>): WorldAction => ({ type: 'say', who: 'athena', key, params });

export function athenaScript(cmd: AthenaCommand, world: World): AthenaStep[] {
  const you: WorldAction = { type: 'say', who: 'you', key: ATHENA_CHIP_KEY[cmd] };
  switch (cmd) {
    case 'risks': {
      const hits = world.projects.flatMap((p) => attentionDims(p).map((d) => ({ p, d })));
      const ids = hits.map(({ p, d }) => nodeId(p.slug, d.key));
      const worst = hits[0];
      return [
        { at: 0, actions: [you, { type: 'busy', busy: true }, { type: 'home' }] },
        { at: 700, actions: [{ type: 'highlight', ids }] },
        {
          at: 1300,
          actions: [
            say('athena_say_risks', {
              count: hits.length,
              projects: new Set(hits.map((h) => h.p.slug)).size,
              worst: worst ? DIM_REGISTRY[worst.d.key].label : '',
              project: worst?.p.name ?? '',
            }),
            { type: 'busy', busy: false },
          ],
        },
      ];
    }
    case 'ship': {
      const steps: AthenaStep[] = [{ at: 0, actions: [you, { type: 'busy', busy: true }, { type: 'highlight', ids: [] }] }];
      let at = 500;
      for (const p of world.projects) {
        steps.push({ at, actions: [{ type: 'open-project', slug: p.slug }] });
        steps.push({
          at: at + 900,
          actions: [
            say(p.ship.late ? 'athena_say_ship_late' : 'athena_say_ship', {
              project: p.name,
              milestone: p.ship.next ?? '',
              shipped: p.ship.shipped,
              total: p.ship.total,
              date: p.ship.targetDate ?? '',
            }),
          ],
        });
        at += 2600;
      }
      steps.push({ at, actions: [{ type: 'home' }, { type: 'busy', busy: false }] });
      return steps;
    }
    case 'focus': {
      const slug = 'brainiac';
      const dim: DimKey = 'security';
      const p = findProject(world, slug);
      return [
        { at: 0, actions: [you, { type: 'busy', busy: true }, { type: 'highlight', ids: [nodeId(slug, dim)] }] },
        { at: 300, actions: [say('athena_say_focus', { dim: DIM_REGISTRY[dim].label, project: p?.name ?? slug }), { type: 'open-project', slug }] },
        { at: 1500, actions: [{ type: 'open-dim', slug, dim }, { type: 'busy', busy: false }] },
      ];
    }
    case 'wire': {
      const slug = 'brainiac';
      const dim: DimKey = 'monitoring';
      const p = findProject(world, slug);
      const id = nodeId(slug, dim);
      return [
        { at: 0, actions: [you, { type: 'busy', busy: true }, { type: 'highlight', ids: [id] }] },
        { at: 300, actions: [{ type: 'open-project', slug }, say('athena_say_wire_start', { project: p?.name ?? slug })] },
        { at: 1500, actions: [{ type: 'open-dim', slug, dim }] },
        { at: 3200, actions: [{ type: 'override', id, status: 'solid', detail: 'Sentry (bound by Athena)', figure: '0 open issues' }] },
        { at: 3700, actions: [say('athena_say_wire_done', { project: p?.name ?? slug }), { type: 'busy', busy: false }] },
      ];
    }
    default:
      return [];
  }
}
