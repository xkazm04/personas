import { useState } from 'react';
import { Plus, Loader2, Clock, Webhook } from 'lucide-react';
import {
  cloudCreateTrigger,
} from '@/api/system/cloud';
import { CRON_PRESETS } from './cloudSchedulesHelpers';
import type { Persona } from '@/lib/types/types';

interface CreateTriggerFormProps {
  deployedPersonas: Persona[];
  onCreated: () => void;
  onCancel: () => void;
}

export function CreateTriggerForm({ deployedPersonas, onCreated, onCancel }: CreateTriggerFormProps) {
  const [createPersonaId, setCreatePersonaId] = useState('');
  const [createType, setCreateType] = useState<'schedule' | 'webhook'>('schedule');
  const [createCron, setCreateCron] = useState('0 * * * *');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!createPersonaId || isCreating) return;
    setIsCreating(true);
    try {
      const config = createType === 'schedule'
        ? JSON.stringify({ cron: createCron })
        : JSON.stringify({ event_type: 'webhook' });
      await cloudCreateTrigger(createPersonaId, createType, config, true);
      onCreated();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="rounded-xl bg-secondary/30 border border-indigo-500/15 p-4 space-y-3">
      <h4 className="text-sm font-medium text-foreground/90">New Cloud Trigger</h4>

      {/* Persona selector */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/70">Persona (must be deployed)</label>
        <select
          value={createPersonaId}
          onChange={(e) => setCreatePersonaId(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
        >
          <option value="">Select persona...</option>
          {deployedPersonas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Trigger type */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/70">Trigger Type</label>
        <div className="flex gap-2">
          <button
            onClick={() => setCreateType('schedule')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors ${
              createType === 'schedule'
                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                : 'bg-secondary/40 text-muted-foreground/70 border-primary/15 hover:border-primary/25'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Schedule (Cron)
          </button>
          <button
            onClick={() => setCreateType('webhook')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors ${
              createType === 'webhook'
                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                : 'bg-secondary/40 text-muted-foreground/70 border-primary/15 hover:border-primary/25'
            }`}
          >
            <Webhook className="w-3.5 h-3.5" />
            Webhook
          </button>
        </div>
      </div>

      {/* Cron config */}
      {createType === 'schedule' && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground/70">Cron Expression <span className="text-amber-400/60 font-medium">(UTC)</span></label>
          <input
            type="text"
            value={createCron}
            onChange={(e) => setCreateCron(e.target.value)}
            placeholder="0 * * * *"
            className="w-full px-3 py-1.5 text-sm font-mono rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
          />
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.cron}
                onClick={() => setCreateCron(preset.cron)}
                className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                  createCron === preset.cron
                    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25'
                    : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:border-primary/20'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Webhook info */}
      {createType === 'webhook' && (
        <p className="text-xs text-muted-foreground/60">
          A webhook endpoint will be created for this trigger. You can configure payload filtering after creation.
        </p>
      )}

      {/* Create actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={!createPersonaId || isCreating}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-40 transition-colors"
        >
          {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {isCreating ? 'Creating...' : 'Create Trigger'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-xl border border-primary/15 text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
