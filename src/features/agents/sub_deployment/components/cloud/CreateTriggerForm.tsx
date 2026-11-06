import { useTranslation } from '@/i18n/useTranslation';
import { useState } from 'react';
import { Plus, Clock, Webhook } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import {
  cloudCreateTrigger,
} from '@/api/system/cloud';
import { toastCatch } from '@/lib/silentCatch';
import { parseCron } from '@/lib/utils/cronNextFire';
import { CLOUD_CRON_PRESETS, cloudCronPresetLabel } from './cloudSchedulesHelpers';
import type { Persona } from '@/lib/types/types';

interface CreateTriggerFormProps {
  deployedPersonas: Persona[];
  onCreated: () => void;
  onCancel: () => void;
}

export function CreateTriggerForm({ deployedPersonas, onCreated, onCancel }: CreateTriggerFormProps) {
  const { t } = useTranslation();
  const dt = t.deployment.trigger_form;
  const [createPersonaId, setCreatePersonaId] = useState('');
  const [createType, setCreateType] = useState<'schedule' | 'webhook'>('schedule');
  const [createCron, setCreateCron] = useState('0 * * * *');
  const [isCreating, setIsCreating] = useState(false);
  const cronInvalid = createType === 'schedule' && parseCron(createCron) === null;

  const handleCreate = async () => {
    if (!createPersonaId || isCreating || cronInvalid) return;
    setIsCreating(true);
    try {
      const config = createType === 'schedule'
        ? JSON.stringify({ cron: createCron })
        : JSON.stringify({ event_type: 'webhook' });
      await cloudCreateTrigger(createPersonaId, createType, config, true);
      onCreated();
    } catch (err) {
      toastCatch('CreateTriggerForm:create')(err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="rounded-modal bg-surface-1 border border-role-agent/15 p-4 space-y-3">
      <h4 className="typo-body text-ink-1">{dt.new_cloud_trigger}</h4>

      {/* Persona selector */}
      <div className="space-y-1">
        <label htmlFor="cloud-trigger-persona" className="typo-caption text-ink-2">{dt.persona_must_be_deployed}</label>
        <select
          id="cloud-trigger-persona"
          value={createPersonaId}
          onChange={(e) => setCreatePersonaId(e.target.value)}
          className="w-full px-3 py-1.5 typo-body rounded-modal bg-surface-2 border border-hair text-ink-1 focus-visible:outline-none focus-visible:border-role-agent/40 transition-colors"
        >
          <option value="">{dt.select_persona}</option>
          {deployedPersonas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Trigger type */}
      <div className="space-y-1">
        <span id="cloud-trigger-type-label" className="typo-caption text-ink-2">{dt.trigger_type}</span>
        <div role="group" aria-labelledby="cloud-trigger-type-label" className="flex gap-2">
          <Button
            type="button"
            aria-pressed={createType === 'schedule'}
            onClick={() => setCreateType('schedule')}
            variant={createType === 'schedule' ? 'secondary' : 'ghost'}
            size="sm"
            icon={<Clock className="w-3.5 h-3.5" />}
          >{dt.schedule_cron}</Button>
          <Button
            type="button"
            aria-pressed={createType === 'webhook'}
            onClick={() => setCreateType('webhook')}
            variant={createType === 'webhook' ? 'secondary' : 'ghost'}
            size="sm"
            icon={<Webhook className="w-3.5 h-3.5" />}
          >{t.deployment.cloud_trigger_webhook}</Button>
        </div>
      </div>

      {/* Cron config */}
      {createType === 'schedule' && (
        <div className="space-y-2">
          <label htmlFor="cloud-trigger-cron" className="typo-caption text-ink-2">{dt.cron_expression} <span className="text-status-warning font-medium">{dt.utc_suffix}</span></label>
          <input
            id="cloud-trigger-cron"
            type="text"
            value={createCron}
            onChange={(e) => setCreateCron(e.target.value)}
            placeholder="0 * * * *"
            aria-invalid={cronInvalid}
            className="w-full px-3 py-1.5 typo-code rounded-modal bg-surface-2 border border-hair text-ink-1 focus-visible:outline-none focus-visible:border-role-agent/40 transition-colors"
          />
          {cronInvalid && (
            <p role="alert" className="typo-caption text-status-error">{t.triggers.build_validation.cron_invalid}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {CLOUD_CRON_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                aria-pressed={createCron === preset.cron}
                onClick={() => setCreateCron(preset.cron)}
                variant={createCron === preset.cron ? 'secondary' : 'ghost'}
                size="xs"
              >{cloudCronPresetLabel(t, preset)}</Button>
            ))}
          </div>
        </div>
      )}

      {/* Webhook info */}
      {createType === 'webhook' && (
        <p className="typo-caption text-ink-2">
          {dt.webhook_info}
        </p>
      )}

      {/* Create actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="accent"
          tone="agent"
          size="sm"
          onClick={handleCreate}
          disabled={!createPersonaId || cronInvalid}
          loading={isCreating}
          loadingLabel={dt.creating}
          icon={<Plus className="w-3.5 h-3.5" />}
        >
          {dt.create_trigger}
        </Button>
        <Button type="button" onClick={onCancel} variant="secondary" size="sm">{t.common.cancel}</Button>
      </div>
    </div>
  );
}
