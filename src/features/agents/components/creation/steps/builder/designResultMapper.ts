import type { NotificationChannel } from '@/lib/types/frontendTypes';
import type { AgentIR } from '@/lib/types/designTypes';
import type { BuilderState, BuilderUseCase, BuilderComponent, TriggerPreset, ComponentRole } from './types';
import { TRIGGER_PRESETS } from './types';
import { makeId } from './builderReducer';

// -- Design result mapping helpers --

export function matchTriggerPreset(triggerType: string, cron?: string): TriggerPreset | null {
  if (cron) {
    const match = TRIGGER_PRESETS.find((p) => p.cron === cron);
    if (match) return match;
  }
  if (triggerType === 'webhook') return TRIGGER_PRESETS.find((p) => p.type === 'webhook') ?? null;
  if (triggerType === 'manual') return TRIGGER_PRESETS.find((p) => p.type === 'manual') ?? null;
  if (triggerType === 'schedule' && cron) {
    return { label: `Custom (${cron})`, type: 'schedule', cron };
  }
  return null;
}

/** Map a suggested connector role string to our ComponentRole */
export function inferRole(sc: { role?: string; category?: string; name: string }): ComponentRole {
  const r = (sc.role ?? sc.category ?? '').toLowerCase();
  if (r.includes('retriev') || r.includes('fetch') || r.includes('input') || r.includes('source')) return 'retrieve';
  if (r.includes('stor') || r.includes('database') || r.includes('save') || r.includes('persist')) return 'store';
  if (r.includes('notif') || r.includes('alert') || r.includes('message')) return 'notify';
  return 'act'; // default
}

export function applyDesignResult(state: BuilderState, result: AgentIR): BuilderState {
  let next = { ...state };

  // Use cases
  const instructions = result.structured_prompt?.instructions;
  if (instructions && state.useCases.length === 0) {
    const lines = instructions.split('\n').filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
    const newCases: BuilderUseCase[] = lines.slice(0, 5).map((line) => ({
      id: makeId('uc'),
      title: line.replace(/^[\s\-*]+/, '').slice(0, 80),
      description: '',
      category: 'automation',
      executionMode: 'e2e' as const,
      trigger: null,
    }));
    if (newCases.length > 0) {
      next = { ...next, useCases: [...next.useCases, ...newCases] };
    }
  }

  // Triggers
  if (result.suggested_triggers?.length > 0) {
    const t = result.suggested_triggers[0];
    if (t) {
      const preset = matchTriggerPreset(t.trigger_type, t.config?.cron as string | undefined);
      if (preset) next = { ...next, globalTrigger: preset };
    }
  }

  // Connectors -> components with inferred roles
  if (result.suggested_connectors?.length) {
    const existingNames = new Set(next.components.map((c) => c.connectorName));
    const newComponents: BuilderComponent[] = result.suggested_connectors
      .filter((sc) => !existingNames.has(sc.name))
      .map((sc) => ({
        id: makeId('comp'),
        role: inferRole(sc),
        connectorName: sc.name,
        credentialId: null,
      }));
    next = { ...next, components: [...next.components, ...newComponents] };
  }

  // Notification channels
  if (result.suggested_notification_channels?.length) {
    const existingTypes = new Set(next.channels.map((c) => c.type));
    const newChannels: NotificationChannel[] = result.suggested_notification_channels
      .filter((ch) => !existingTypes.has(ch.type))
      .map((ch) => ({
        type: ch.type,
        enabled: true,
        config: ch.config_hints ?? {},
      }));
    next = { ...next, channels: [...next.channels, ...newChannels] };
  }

  // Summary -> intent
  if (!next.intent.trim() && result.summary) {
    next = { ...next, intent: result.summary };
  }

  return next;
}
